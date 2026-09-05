import os
from pathlib import Path

from dotenv import load_dotenv

# 打包成桌面应用时，可通过 APP_ENV_FILE 指向用户可写目录里的 .env（例如
# ~/Library/Application Support/职事英语/.env），避免修改 .app 内的只读文件。
# 未设置时保持原行为：从当前工作目录加载 .env。
_env_file = os.getenv("APP_ENV_FILE")
if _env_file and os.path.exists(_env_file):
    load_dotenv(_env_file)
else:
    load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# 桌面应用会用 APP_DATA_DIR 覆盖数据目录，让数据库、媒体等落在用户可写的
# Application Support 目录里（.app 内部是只读的）。开发模式下保持 backend/data。
_data_override = os.getenv("APP_DATA_DIR")
if _data_override:
    DATA_DIR = Path(_data_override)
else:
    DATA_DIR = BASE_DIR / "data"

MEDIA_DIR = DATA_DIR / "media"
AUDIO_CLIPS_DIR = DATA_DIR / "audio_clips"
RECORDINGS_DIR = DATA_DIR / "recordings"
DB_PATH = DATA_DIR / "db" / "app.db"

# 打包后由程序把构建好的前端静态文件目录通过该变量传入，用于服务 SPA。
FRONTEND_DIST = os.getenv("FRONTEND_DIST", "")

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
