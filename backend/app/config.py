import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"
AUDIO_CLIPS_DIR = DATA_DIR / "audio_clips"
RECORDINGS_DIR = DATA_DIR / "recordings"
DB_PATH = DATA_DIR / "db" / "app.db"

for d in (MEDIA_DIR, AUDIO_CLIPS_DIR, RECORDINGS_DIR, DB_PATH.parent):
    d.mkdir(parents=True, exist_ok=True)

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash").strip()

AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY", "").strip()
AZURE_SPEECH_REGION = os.getenv("AZURE_SPEECH_REGION", "").strip()

DEEPSEEK_ENABLED = bool(DEEPSEEK_API_KEY)
AZURE_ENABLED = bool(AZURE_SPEECH_KEY and AZURE_SPEECH_REGION)
