def _ms_to_srt_time(ms: int) -> str:
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ms_to_vtt_time(ms: int) -> str:
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def to_srt(sentences: list[dict]) -> str:
    lines = []
    for i, s in enumerate(sentences, start=1):
        text = s["text_polished"] or s["text_raw"]
        lines.append(str(i))
        lines.append(f"{_ms_to_srt_time(s['start_ms'])} --> {_ms_to_srt_time(s['end_ms'])}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def to_vtt(sentences: list[dict]) -> str:
    lines = ["WEBVTT", ""]
    for s in sentences:
        text = s["text_polished"] or s["text_raw"]
        lines.append(f"{_ms_to_vtt_time(s['start_ms'])} --> {_ms_to_vtt_time(s['end_ms'])}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)
