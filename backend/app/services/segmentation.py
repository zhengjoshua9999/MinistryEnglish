"""Group Whisper's word-level timestamps into subtitle sentences.

Two passes:
1. Boundary detection — start a new sentence after sentence-ending punctuation
   or a long pause, gated by a minimum word count so short utterances
   ("Amen.") merge into a neighboring sentence instead of standing alone.
2. Long-sentence splitting — Watchman Nee / Witness Lee style preaching
   produces long, comma-heavy run-on sentences with few internal pauses long
   enough to trip the boundary detector. Sentences over MAX_WORDS get split
   at their best internal pause/comma/clause-start points into evenly-sized
   chunks. Only uses Whisper's own word timestamps — no DeepSeek involved.
"""

SENTENCE_ENDERS = (".", "!", "?")
PAUSE_BREAK_MS = 700
MIN_WORDS = 4
MAX_WORDS = 28
TARGET_SPLIT_WORDS = 17
CLAUSE_STARTERS = {"which", "who", "whom", "that", "and", "but", "so", "for", "because"}


def segment_words(words: list[dict]) -> list[dict]:
    """words: [{"word": str, "start": float_seconds, "end": float_seconds}, ...]"""
    sentences: list[dict] = []
    current: list[dict] = []

    def flush():
        if not current:
            return
        sentences.extend(_split_long(current))
        current.clear()

    prev_end = None
    for w in words:
        is_pause = prev_end is not None and (w["start"] - prev_end) * 1000 > PAUSE_BREAK_MS
        if is_pause and len(current) >= MIN_WORDS:
            flush()
        current.append(w)
        stripped = w["word"].strip()
        if stripped.endswith(SENTENCE_ENDERS) and len(current) >= MIN_WORDS:
            flush()
        prev_end = w["end"]

    flush()
    return sentences


def _to_sentence_dict(words: list[dict]) -> dict:
    text = "".join(w["word"] for w in words).strip()
    return {
        "start_ms": int(words[0]["start"] * 1000),
        "end_ms": int(words[-1]["end"] * 1000),
        "text": text,
    }


def _split_long(words: list[dict]) -> list[dict]:
    """A finished sentence's word list; split into evenly-sized chunks at the
    best available pause / comma / clause-start points if it's too long."""
    text = "".join(w["word"] for w in words).strip()
    if not text:
        return []
    if len(words) <= MAX_WORDS:
        return [_to_sentence_dict(words)]

    n_parts = max(2, round(len(words) / TARGET_SPLIT_WORDS))
    targets = [round(len(words) * i / n_parts) for i in range(1, n_parts)]
    search_radius = max(3, TARGET_SPLIT_WORDS // 3)

    split_indices: list[int] = []
    for target in targets:
        best_idx, best_score = None, float("-inf")
        lo = max(1, target - search_radius)
        hi = min(len(words) - 1, target + search_radius)
        for i in range(lo, hi + 1):
            if i in split_indices:
                continue
            pause_ms = max(0.0, (words[i]["start"] - words[i - 1]["end"]) * 1000)
            has_comma = words[i - 1]["word"].strip().endswith((",", ";", "—", "-"))
            starts_clause = words[i]["word"].strip().lower().strip(",.;") in CLAUSE_STARTERS
            score = pause_ms + (250 if has_comma else 0) + (150 if starts_clause else 0) - abs(i - target) * 5
            if score > best_score:
                best_idx, best_score = i, score
        if best_idx is not None:
            split_indices.append(best_idx)

    split_indices = sorted(set(split_indices))
    if not split_indices:
        return [_to_sentence_dict(words)]

    chunks: list[list[dict]] = []
    start = 0
    for idx in split_indices:
        chunks.append(words[start:idx])
        start = idx
    chunks.append(words[start:])

    # 兜底：拆完万一有块特别短，并回前一块，不单独成句
    merged: list[list[dict]] = []
    for chunk in chunks:
        if merged and len(chunk) < MIN_WORDS:
            merged[-1] = merged[-1] + chunk
        else:
            merged.append(chunk)

    return [_to_sentence_dict(c) for c in merged if c]
