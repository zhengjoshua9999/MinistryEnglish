from __future__ import annotations

import re
from mimetypes import guess_type
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.responses import Response, StreamingResponse

CHUNK_SIZE = 1024 * 1024
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _resolve_within(base: Path, filename: str) -> Path:
    base_resolved = base.resolve()
    candidate = (base_resolved / filename).resolve()
    if not candidate.is_relative_to(base_resolved) or not candidate.is_file():
        raise HTTPException(404, "文件不存在")
    return candidate


async def serve_file_range(request: Request, base: Path, filename: str) -> Response:
    """支持 HTTP Range 的静态文件响应。Starlette 自带的 StaticFiles/FileResponse
    都不处理 Range 请求头（无论有没有 Range 头一律回整个文件、状态码 200），导致
    <audio>/<video> 标签对大文件做 seek（跳转播放位置）完全不生效——浏览器发 Range
    请求过去，服务端不理会，播放位置就没法跳转。这里手写一个最小实现，只服务于
    /media /audio_clips /recordings 这三个本地媒体目录。"""
    path = _resolve_within(base, filename)
    file_size = path.stat().st_size
    media_type = guess_type(path.name)[0] or "application/octet-stream"
    range_header = request.headers.get("range")

    if range_header:
        match = RANGE_RE.match(range_header)
        if not match or not (match.group(1) or match.group(2)):
            raise HTTPException(416, "Range 请求格式不正确")
        start_str, end_str = match.groups()
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        if start > end or start >= file_size:
            raise HTTPException(416, headers={"Content-Range": f"bytes */{file_size}"}, detail="请求范围不满足")

        length = end - start + 1

        def iter_range():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
        }
        return StreamingResponse(iter_range(), status_code=206, media_type=media_type, headers=headers)

    def iter_full():
        with open(path, "rb") as f:
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(file_size)}
    return StreamingResponse(iter_full(), status_code=200, media_type=media_type, headers=headers)
