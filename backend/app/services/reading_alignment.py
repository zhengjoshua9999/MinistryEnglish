from __future__ import annotations

import math
import os
import re
from functools import lru_cache


_MODEL = None


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-zA-Z']+|[\u4e00-\u9fff]", text.lower()) if len(token) > 1}


def _fallback_similarity(a: str, b: str) -> float:
    left, right = _tokens(a), _tokens(b)
    if not left or not right:
        return 0.0
    return len(left & right) / math.sqrt(len(left) * len(right))


def semantic_similarity(a: str, b: str) -> float:
    """Use a local multilingual sentence-transformer when installed.

    The lexical fallback keeps import and tests usable before the model is
    downloaded. Setting READING_EMBEDDING_MODEL changes the local model name.
    """
    global _MODEL
    try:
        from sentence_transformers import SentenceTransformer, util
    except ImportError:
        return _fallback_similarity(a, b)
    try:
        if _MODEL is None:
            model_name = os.getenv("READING_EMBEDDING_MODEL", "paraphrase-multilingual-mpnet-base-v2")
            _MODEL = SentenceTransformer(model_name)
        vectors = _MODEL.encode([a, b], normalize_embeddings=True)
        return float(util.cos_sim(vectors[0], vectors[1]))
    except Exception:
        return _fallback_similarity(a, b)


def _ratio_score(english: str, chinese: str) -> float:
    english_words = max(1, len(re.findall(r"[A-Za-z]+", english)))
    chinese_chars = max(1, len(re.findall(r"[\u4e00-\u9fff]", chinese)))
    # The ratio varies by translation style; this only downweights outliers.
    return math.exp(-abs(math.log(chinese_chars / (english_words * 1.7))))


def _pair_score(english: str, chinese: str, en_pos: float, zh_pos: float) -> float:
    position = max(0.0, 1.0 - abs(en_pos - zh_pos) * 1.8)
    semantic = max(0.0, min(1.0, semantic_similarity(english, chinese)))
    ratio = max(0.0, min(1.0, _ratio_score(english, chinese)))
    return 0.45 * semantic + 0.30 * position + 0.25 * ratio


def align_chapter(english: list[str], chinese: list[str]) -> list[dict]:
    """Align two paragraph sequences with a small monotonic dynamic program."""
    n, m = len(english), len(chinese)

    @lru_cache(maxsize=None)
    def solve(i: int, j: int) -> tuple[float, tuple[tuple[int, int, float], ...]]:
        if i >= n and j >= m:
            return 0.0, ()
        options: list[tuple[float, tuple[tuple[int, int, float], ...]]] = []
        en_pos = i / max(1, n - 1)
        zh_pos = j / max(1, m - 1)
        for en_count, zh_count, penalty in ((1, 1, 0.0), (1, 2, 0.04), (2, 1, 0.04)):
            if i + en_count <= n and j + zh_count <= m:
                en_text = " ".join(english[i : i + en_count])
                zh_text = "".join(chinese[j : j + zh_count])
                score = _pair_score(en_text, zh_text, en_pos, zh_pos) - penalty
                tail_score, tail = solve(i + en_count, j + zh_count)
                options.append((score + tail_score, ((en_count, zh_count, score),) + tail))
        if i < n:
            tail_score, tail = solve(i + 1, j)
            options.append((tail_score - 0.36, ((1, 0, 0.0),) + tail))
        if j < m:
            tail_score, tail = solve(i, j + 1)
            options.append((tail_score - 0.36, ((0, 1, 0.0),) + tail))
        return max(options, key=lambda item: item[0])

    _, path = solve(0, 0)
    result: list[dict] = []
    en_idx = zh_idx = 0
    for en_count, zh_count, score in path:
        en_ids = list(range(en_idx, en_idx + en_count)) if en_count else []
        zh_ids = list(range(zh_idx, zh_idx + zh_count)) if zh_count else []
        en_idx += en_count
        zh_idx += zh_count
        if en_count and zh_count:
            alignment_type = "one_to_one" if en_count == zh_count == 1 else "one_to_many" if en_count == 1 else "many_to_one"
            confidence = max(0.0, min(1.0, score))
        else:
            alignment_type = "unmatched"
            confidence = 0.0
        result.append({"english_indices": en_ids, "chinese_indices": zh_ids, "alignment_type": alignment_type, "confidence": confidence})
    return result
