# 职事英语 —— macOS 桌面版

把 e世代的「职事英语」打成一个可直接安装的 macOS 桌面应用（.dmg），分 **Apple 芯片（arm64）**和 **Intel 芯片（x86_64）**两个版本。

## 它是怎么工作的

- 桌面壳用 **Electron** 打开一个窗口；
- 首次运行会用内置的 **uv** 在当前用户目录自动建一个 Python 虚拟环境，联网安装
  `backend/requirements.txt`（包含 whisper / torch / sentence-transformers 等大依赖）；
- 然后启动 **FastAPI 后端**，后端同时托管构建好的前端静态页面与全部 API；
- 所有数据（数据库、上传的媒体、录音、生词表、阅读书籍）默认存在
  `~/Library/Application Support/职事英语/`，不会写进 `.app`（它是只读的）。

> `backend/.env`（含 DeepSeek / Azure 密钥）在首次运行时被复制到上面的用户目录，之后可直接编辑那个副本。
> 依赖与模型遵循你的选择：**首次运行联网下载**，因此安装包体积小；离线转写需要先联网下载一次 Whisper 模型。

## 目录结构

```
desktop/
  main.js              Electron 主进程（建 venv、起后端、开窗口）
  preload.js           渲染进程桥接
  electron-builder.yml 打包配置（dmg、资源拷贝）
  assets/loading.html  首次启动的“正在安装”动画页
  build.sh             一键构建脚本（构建前端、聚合资源、下载 uv、electron-builder）
  build-resources/     构建时生成：backend / frontend / bin(uv)
```

## 在本机构建（本机架构一个版本）

```bash
bash desktop/build.sh
# 产物：desktop/release/0.1.0/ZhishiYingyu-0.1.0-<arch>.dmg
```

只出 `.app`（不打包成 dmg）：

```bash
cd desktop && npm ci && npx electron-builder --mac --dir
# 产物：desktop/release/0.1.0/mac-<arch>/职事英语.app
```

> 注意：如果所在环境被文件沙箱限制，`hdiutil`（dmg 生成）和 Electron/Chromium 的
> 自启沙箱会失败，导致“无法生成 dmg / 无法启动窗口”。这种情况请在**真实 Mac** 或
> GitHub Actions 上构建；dmg 和启动本身没有问题。

用 `DSH_DEV=1` 可只跑（不打包）调试壳，后端复用本机已有的 Python 环境：

```bash
cd desktop && DSH_DEV=1 DSH_RESOURCES_DIR="$PWD/build-resources" npm start
```

## 同时出 Intel 与 M 芯片两个版本

原生 Python 扩展（torch、ctranslate2 等）**无法跨架构交叉编译**，所以两个版本要在各自的架构上构建。仓库提供了 GitHub Actions 工作流：

[`.github/workflows/build-mac.yml`](../.github/workflows/build-mac.yml)

- `macos-14`（arm64，M 芯片）：产出 `...arm64.dmg`
- `macos-13`（x86_64，Intel）：产出 `...x64.dmg`

推到 GitHub 后手动运行该 workflow，两个 dmg 会作为附件上传；**打 tag（`v0.1.0` 等）会自动发布成 GitHub Release**，两个 dmg 挂在 Release 附件上，可直接下载安装。

### 从 GitHub 安装（Intel / M 芯片都适用）

> 仓库是**私有**的，所以 `raw.githubusercontent.com` / Release 附件对匿名 `curl` 一律 404，
> 必须带登录态。安装脚本已优先使用 `gh`（GitHub CLI）来认证下载 dmg。

**① 仓库内直接跑（推荐，你本地就有代码）：**

```bash
bash scripts/install-macos.sh
```

**② 在另一台全新 Mac 上（有该仓库访问权限，装好 `gh` 并登录）：**

```bash
brew install gh && gh auth login
gh api repos/zhengjoshua9999/MinistryEnglish/contents/scripts/install-macos.sh \
  --jq .content | base64 -d > /tmp/install.sh && bash /tmp/install.sh
```

脚本会自动识别芯片（arm64 → `...arm64.dmg`，x86_64 → `...x64.dmg`）、用 `gh` 从最新 Release 下载、
挂载并把 `职事英语.app` 装进 `/Applications`，还会去掉未签名应用的隔离标记。

> 若将来把仓库设为公开，可换回更短的匿名一条龙：`curl -fsSL https://raw.githubusercontent.com/zhengjoshua9999/MinistryEnglish/main/scripts/install-macos.sh | bash`。

## 关于签名 / 公证

本地打包默认关闭签名（`electron-builder.yml` 里 `mac.identity: null`）。因此：

- 双击 dmg 里拖入「应用程序」后，首次打开会提示“无法验证开发者 / 已损坏”。
- 打开方式：右键点应用 →「打开」→ 再点「打开」；或在「系统设置 → 隐私与安全性」里点「仍要打开」。
- 若要发布给别人，请在 Apple Developer 账号下配置签名与公证（`identity` + notarize），否则任何机器首次打开都会拦截。

## 可改的配置（后端）

首次运行后，编辑 `~/Library/Application Support/职事英语/.env`：

| 变量 | 说明 |
| --- | --- |
| `WHISPER_MODEL` | tiny / base / small / medium / large-v3（首次转写下载） |
| `WHISPER_DEVICE` | cpu（Apple 芯片建议 cpu，已足够快） |
| `DEEPSEEK_API_KEY` | 文本润色 / 生词释义；留空则跳过 |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | 跟读评分 / 标准美式·英式发音；留空则跳过 |
