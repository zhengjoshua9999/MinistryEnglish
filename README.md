# 水流职事英语跟读平台

本地优先的字幕生成 + 跟读评分工具。语音识别（Whisper）完全在本机运行；DeepSeek 只用于文本润色和生词释义；Azure Speech 用于跟读发音评分和标准美式/英式发音，两者都是可选项——不配置 API key 时功能会自动跳过，不影响核心的上传/转写/跟读流程。

## 目录结构

- `backend/` — FastAPI 服务，负责上传、Whisper 转写、断句、生词本、发音评分
- `frontend/` — Vite + React 前端，上传页 / 跟读练习页 / 生词本页

## 启动后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 按需填入 DEEPSEEK_API_KEY / AZURE_SPEECH_KEY
uvicorn app.main:app --reload --port 8000
```

首次转写会自动从 Hugging Face 下载 Whisper 模型（默认 `small`，可在 `.env` 里改 `WHISPER_MODEL`），需要联网，之后离线可用。

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 ，前端会把 `/api`、`/media`、`/audio_clips` 代理到后端的 8000 端口。

## 关于 DeepSeek / Azure

- 不填 `DEEPSEEK_API_KEY`：字幕保留 Whisper 原始断句（不影响使用），生词释义/翻译留空。
- 不填 `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`：跟读录音会正常保存，但评分都是 0；生词的标准美式/英式发音不生成。

## 术语库

后端启动时会自动写入一批水流职事常见术语（Watchman Nee、Witness Lee、the divine dispensing 等），可通过 `/api/glossary` 增删——这些术语会作为 Whisper 的识别提示词，减少专有表达被听错的情况。
