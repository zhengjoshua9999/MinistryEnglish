"""Azure Speech: pronunciation assessment (shadowing scores) and neural TTS
(standard US/UK reference pronunciation for the vocab book). Both are no-ops
— callers get None / not-called — when AZURE_SPEECH_KEY/REGION aren't set.
"""

from __future__ import annotations

import time

import azure.cognitiveservices.speech as speechsdk
import requests

from app import config

TIMEOUT = 30
_token_cache = {"value": None, "expires_at": 0.0}

US_VOICE = "en-US-AndrewNeural"
UK_VOICE = "en-GB-RyanNeural"


def _get_token() -> str:
    now = time.time()
    if _token_cache["value"] and now < _token_cache["expires_at"]:
        return _token_cache["value"]

    resp = requests.post(
        f"https://{config.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken",
        headers={"Ocp-Apim-Subscription-Key": config.AZURE_SPEECH_KEY, "Content-Length": "0"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    token = resp.text
    _token_cache["value"] = token
    _token_cache["expires_at"] = now + 9 * 60  # tokens last 10 min, refresh a bit early
    return token


def assess_pronunciation(wav_path: str, reference_text: str) -> dict | None:
    """Returns {accuracy, fluency, completeness, pron_score, words: [...]}

    Uses the Speech SDK rather than the short-audio REST endpoint: the REST
    endpoint only ever returns AccuracyScore (overall + per word) — Fluency,
    Completeness and the overall PronScore are silently absent from that
    response, confirmed against a live call. The SDK's
    PronunciationAssessmentResult is the path that actually returns all four.
    """
    if not config.AZURE_ENABLED:
        return None

    speech_config = speechsdk.SpeechConfig(
        subscription=config.AZURE_SPEECH_KEY, region=config.AZURE_SPEECH_REGION
    )
    audio_config = speechsdk.audio.AudioConfig(filename=wav_path)
    pron_config = speechsdk.PronunciationAssessmentConfig(
        reference_text=reference_text,
        grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
        granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
        enable_miscue=True,
    )

    recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config, language="en-US", audio_config=audio_config
    )
    pron_config.apply_to(recognizer)

    result = recognizer.recognize_once()
    if result.reason != speechsdk.ResultReason.RecognizedSpeech:
        return None

    pa = speechsdk.PronunciationAssessmentResult(result)
    words = [
        {
            "word": w.word,
            "accuracy": w.accuracy_score,
            "error_type": w.error_type,
        }
        for w in pa.words
    ]

    return {
        "accuracy": pa.accuracy_score,
        "fluency": pa.fluency_score,
        "completeness": pa.completeness_score,
        "pron_score": pa.pronunciation_score,
        "words": words,
    }


def synthesize_speech(text: str, voice: str) -> bytes | None:
    if not config.AZURE_ENABLED:
        return None

    token = _get_token()
    ssml = (
        f'<speak version="1.0" xml:lang="en-US">'
        f'<voice name="{voice}">{text}</voice>'
        f"</speak>"
    )
    resp = requests.post(
        f"https://{config.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "MinistryEnglishApp",
        },
        data=ssml.encode("utf-8"),
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content


def synthesize_us(text: str) -> bytes | None:
    return synthesize_speech(text, US_VOICE)


def synthesize_uk(text: str) -> bytes | None:
    return synthesize_speech(text, UK_VOICE)
