import json
import subprocess
from pathlib import Path


def probe_duration_sec(path: str) -> float:
    out = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(out.stdout)
    return float(data["format"]["duration"])


def extract_audio_wav(src_path: str, dst_path: str) -> None:
    """Extract/convert to 16kHz mono WAV — the format faster-whisper and
    Azure's REST APIs both want, so every downstream step reads the same file."""
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            src_path,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-vn",
            dst_path,
        ],
        capture_output=True,
        check=True,
    )


def clip_wav(src_path: str, dst_path: str, start_ms: int, end_ms: int) -> None:
    Path(dst_path).parent.mkdir(parents=True, exist_ok=True)
    start_sec = max(0, start_ms) / 1000
    duration_sec = max(0, end_ms - start_ms) / 1000
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            src_path,
            "-ss",
            f"{start_sec:.3f}",
            "-t",
            f"{duration_sec:.3f}",
            "-ac",
            "1",
            "-ar",
            "16000",
            dst_path,
        ],
        capture_output=True,
        check=True,
    )
