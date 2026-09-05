# 职事英语

本地优先的字幕生成 + 跟读评分工具。语音识别（Whisper）完全在本机运行；DeepSeek 只用于文本润色和生词释义；Azure Speech 用于跟读发音评分和标准美式/英式发音，两者都是可选项——不配置 API key 时功能会自动跳过，不影响核心的上传/转写/跟读流程。

## 目录结构

- `backend/` — FastAPI 服务，负责上传、Whisper 转写、断句、生词本、发音评分和双语阅读材料
- `frontend/` — Vite + React 前端，上传页 / 跟读练习页 / 生词本页 / 阅读中心

## 阅读模块设计

双语职事书报阅读模块的设计方案见 [`docs/reading-module-design.md`](docs/reading-module-design.md)。方案包括英文 PDF / 中文 EPUB·DOCX 上传、语义相似度辅助的自动段落对齐、人工校对、双栏同步滚动阅读以及与生词本的联动（不涉及跟读评分）。

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

阅读中心首次上传书籍时，会从 Hugging Face 下载本地多语言句向量模型（默认
`paraphrase-multilingual-mpnet-base-v2`，可用 `READING_EMBEDDING_MODEL` 修改），用于辅助中英文段落对齐；下载完成后可离线使用。

阅读中心只接受有文本层的英文 PDF，以及 EPUB 或 DOCX 中文文件。上传后所有自动对齐结果都必须人工确认，发布后才能进入双栏阅读页。

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 ，前端会把 `/api`、`/media`、`/audio_clips` 代理到后端的 8000 端口。

## 打包成 macOS 桌面应用（.dmg）

仓库提供 [Electron 桌面壳](desktop/) 与配套构建脚本，可产出「职事英语 .app / .dmg」：

- 本机架构（当前机器的 arm64 或 x86_64）直接构建：`bash desktop/build.sh`
- 同时出 Intel + Apple 芯片两个版本：手动运行仓库里的
  [`.github/workflows/build-mac.yml`](.github/workflows/build-mac.yml)（`macos-13` 出 x64、`macos-14` 出 arm64），
  两个 dmg 会作为附件下载
- 从 GitHub 安装（仓库是私有的，需带登录态）：打 tag 后会自动发布 Release，
  然后 `bash scripts/install-macos.sh`（或在新机器上用 `gh` 取脚本，见 `desktop/README.md`）
- 安装包较小：首次运行才用内置 `uv` 联网建 Python 环境、安装依赖并下载 Whisper 模型；
  数据（数据库、媒体、录音、生词、阅读书籍）存在 `~/Library/Application Support/职事英语/`

详细说明见 [desktop/README.md](desktop/README.md)。

## 关于 DeepSeek / Azure

- 不填 `DEEPSEEK_API_KEY`：字幕保留 Whisper 原始断句（不影响使用），生词释义/翻译留空。
- 不填 `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`：跟读录音会正常保存，但评分都是 0；生词的标准美式/英式发音不生成。

## 术语库

后端启动时会自动写入一批水流职事常见术语（Watchman Nee、Witness Lee、the divine dispensing 等），可通过 `/api/glossary` 增删——这些术语会作为 Whisper 的识别提示词，减少专有表达被听错的情况。
