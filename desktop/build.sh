#!/usr/bin/env bash
#
# 职事英语 macOS 打包脚本。
# 用法： bash desktop/build.sh
# 在哪个架构上运行，就产出哪个架构的 .dmg（arm64 的 M 芯片机 / x86_64 的 Intel 机）。
# 两个架构同时出需走 .github/workflows/build-mac.yml 的矩阵构建。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESK="$ROOT/desktop"
RES="$DESK/build-resources"
ARCH="$(uname -m)"                 # arm64 | x86_64
UV_VERSION="${UV_VERSION:-0.9.7}"  # 可覆盖

# 避免本机 ~/.npm 缓存被旧版本 npm 写成 root 属主导致 EPERM，
# 打包时用一个项目内、可写的独立 npm 缓存。
NPM_CACHE="${NPM_CACHE:-$DESK/.npm-cache}"
export npm_config_cache="$NPM_CACHE"
export npm_config_fund="false"
export npm_config_audit="false"

# 让 Electron / electron-builder 的下载缓存都落到工作区内，避免被系统沙箱
# 挡掉写入 ~/Library/Caches 的权限。
export ELECTRON_CACHE="$DESK/.cache/electron"
export electron_config_cache="$ELECTRON_CACHE"
export ELECTRON_BUILDER_CACHE="$DESK/.cache/electron-builder"
mkdir -p "$ELECTRON_CACHE" "$ELECTRON_BUILDER_CACHE"

case "$ARCH" in
  arm64) ELECTRON_ARCH="arm64"; UV_TARGET="aarch64-apple-darwin" ;;
  x86_64) ELECTRON_ARCH="x64"; UV_TARGET="x86_64-apple-darwin" ;;
  *) echo "不支持的架构：$ARCH" >&2; exit 1 ;;
esac

echo "==> [1/4] 构建前端（$ROOT/frontend）"
( cd "$ROOT/frontend" && npm ci && npm run build )

echo "==> [2/4] 聚合资源到 $RES"
rm -rf "$RES"
mkdir -p "$RES/backend" "$RES/frontend" "$RES/bin"

# 后端源码 + requirements + .env（若存在）
cp -R "$ROOT/backend/app" "$RES/backend/app"
cp "$ROOT/backend/requirements.txt" "$RES/backend/requirements.txt"
if [ -f "$ROOT/backend/.env" ]; then
  cp "$ROOT/backend/.env" "$RES/backend/.env"
  echo "    .env 已随包复制（含你自己的 DeepSeek/Azure 密钥）"
fi

# 前端构建产物
cp -R "$ROOT/frontend/dist/." "$RES/frontend/"

echo "==> [3/4] 下载 uv ${UV_VERSION} (${UV_TARGET})"
UV_TMP="$(mktemp -d)"
trap 'rm -rf "$UV_TMP"' EXIT
curl -fsSL "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz" \
  -o "$UV_TMP/uv.tar.gz"
tar -xzf "$UV_TMP/uv.tar.gz" -C "$UV_TMP"
cp "$UV_TMP/uv-${UV_TARGET}/uv" "$RES/bin/uv"
chmod +x "$RES/bin/uv"
echo "    uv 就绪：$RES/bin/uv"

echo "==> [4/4] electron-builder (--mac --${ELECTRON_ARCH})"
cd "$DESK"
if [ ! -d node_modules ]; then
  npm install
fi
npx electron-builder --mac --"${ELECTRON_ARCH}"

echo ""
echo "完成。产物：$DESK/release/$(node -p "require('./package.json').version")/"
