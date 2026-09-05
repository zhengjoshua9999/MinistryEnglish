#!/usr/bin/env bash
#
# 职事英语 macOS 一键安装脚本（从私有 GitHub 仓库的 Release 下载对应架构 dmg 并安装）。
#
# 私有仓库的 raw.githubusercontent.com / Release 附件：匿名 curl 一律 404。
# 所以本脚本优先用 GitHub CLI（gh，已登录）来认证：
#   - gh        存在且已登录  -> 用它解析版本、下载 dmg（私有/公开仓库都适用）
#   - gh        不存在/未登录 -> 回退到匿名 curl（仅当仓库是公开时才能成功）
#
# 用法：
#   1) 已在仓库内（推荐，你本地就有代码）：
#        bash scripts/install-macos.sh
#   2) 一台全新 Mac（有该仓库访问权限，装好 gh 并登录）：
#        gh auth login
#        gh api repos/zhengjoshua9999/MinistryEnglish/contents/scripts/install-macos.sh \
#          --jq .content | base64 -d > /tmp/install.sh && bash /tmp/install.sh
#
# 说明：
#   - 自动识别芯片：Apple 芯片(arm64) 下载 ...arm64.dmg；Intel(x86_64) 下载 ...x64.dmg。
#   - 安装到 /Applications/职事英语.app；程序未做 Apple 签名，首次打开需右键→打开。
#
set -euo pipefail

# ---- 1) 仓库（owner/repo）----
REPO="${REPO:-zhengjoshua9999/MinistryEnglish}"
REMOTE="$(git -C "$(dirname "$0")/.." remote get-url origin 2>/dev/null || true)"
if [ -n "$REMOTE" ]; then
  # 支持 https://github.com/a/b.git 和 git@github.com:a/b.git
  REPO="$(echo "$REMOTE" | sed -E 's#.*github.com[:/]##; s#\.git$##')"
fi
echo "仓库：$REPO"

# ---- 2) 识别架构 ----
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) DMG_ARCH="arm64" ;;
  x86_64) DMG_ARCH="x64" ;;
  *) echo "不支持的架构：$ARCH"; exit 1 ;;
esac
echo "芯片架构：$ARCH -> 下载 ${DMG_ARCH}.dmg"

# ---- 3) 是否可用 gh（已登录）----
USE_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  USE_GH=1
fi
if [ "$USE_GH" = 1 ]; then
  echo "使用 gh（已登录）认证下载。"
else
  echo "未检测到已登录的 gh，回退到匿名 curl（仅对公开仓库有效）。"
fi

# ---- 4) 确定版本（默认取最新 Release）----
VERSION="${VERSION:-}"
if [ -z "$VERSION" ]; then
  if [ "$USE_GH" = 1 ]; then
    TAG="$(gh release view --repo "$REPO" --json tagName --jq .tagName 2>/dev/null || true)"
  else
    TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)"
  fi
  if [ -z "$TAG" ]; then
    echo "错误：找不到该仓库的 Release（请先打 v* tag 让 CI 发布，见 .github/workflows/build-mac.yml）。"
    exit 1
  fi
  VERSION="${TAG#v}"
fi
echo "版本：${VERSION}（tag v${VERSION}）"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---- 5) 下载对应架构的 dmg ----
if [ "$USE_GH" = 1 ]; then
  echo "下载：ZhishiYingyu-${VERSION}-${DMG_ARCH}.dmg"
  gh release download "v${VERSION}" --repo "$REPO" \
    --pattern "ZhishiYingyu-${VERSION}-${DMG_ARCH}.dmg" --dir "$WORK" --clobber
  DMG="$(find "$WORK" -maxdepth 1 -name '*.dmg' | head -1)"
  if [ -z "$DMG" ]; then
    echo "错误：该 Release 里没找到 ${DMG_ARCH} 的 dmg。"
    exit 1
  fi
else
  URL="https://github.com/$REPO/releases/download/v${VERSION}/ZhishiYingyu-${VERSION}-${DMG_ARCH}.dmg"
  echo "下载：$URL"
  curl -fL --progress-bar "$URL" -o "$WORK/app.dmg"
  DMG="$WORK/app.dmg"
fi

# ---- 6) 挂载并安装 ----
APP_NAME="职事英语.app"
echo "挂载 dmg 并安装到 /Applications ..."
mkdir -p "$WORK/mnt"
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$WORK/mnt"
cp -R "$WORK/mnt/$APP_NAME" "/Applications/$APP_NAME"
hdiutil detach "$WORK/mnt" -quiet

# 未签名应用：去掉隔离标记，避免“已损坏，无法打开”的拦截。
xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true

echo ""
echo "✅ 已安装：/Applications/$APP_NAME"
echo ""
echo "这是未签名应用，首次打开若提示“无法验证开发者/已损坏”："
echo "  - 到「系统设置 → 隐私与安全性 → 安全性」点「仍要打开」；"
echo "  - 或 右键 /Applications/$APP_NAME →「打开」→「打开」。"
echo "首次启动会联网创建运行环境并下载 Whisper 模型，请保持网络连接。"
