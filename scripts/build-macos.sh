#!/usr/bin/env bash
#
# 构建 macOS 产物（.app + .dmg），走 Tauri 官方打包流程。
#
#   ./scripts/build-macos.sh              # 当前机器架构
#   ./scripts/build-macos.sh x86_64       # Intel（在 Apple Silicon 上交叉编译）
#   ./scripts/build-macos.sh aarch64      # Apple Silicon
#
# 为什么用 tauri build 而不是手工组装 .app：identifier、copyright、
# DMG 布局这些 bundle 配置集中在 tauri.conf.json 里，三个平台共用同一份。
# 手工组装会让 macOS 产物游离在这份配置之外——实测后果是 identifier 与
# copyright 只改了配置却进不了产物，DMG 里也缺少 Applications 快捷方式。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${1:-$(uname -m)}"

case "$ARCH" in
  x86_64|amd64)
    ARCH="x86_64"
    RUST_TARGET="x86_64-apple-darwin"
    DIST_DIR="$ROOT_DIR/dist-intel"
    ;;
  aarch64|arm64)
    ARCH="aarch64"
    RUST_TARGET="aarch64-apple-darwin"
    DIST_DIR="$ROOT_DIR/dist-arm64"
    ;;
  *)
    echo "不支持的架构：$ARCH（请用 x86_64 或 aarch64）" >&2
    exit 2
    ;;
esac

cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "需要 npm" >&2
  exit 1
fi

# 根 package.json 提供 tauri CLI（版本由 package-lock.json 锁定，
# 不依赖全局安装，也不用在 lockfile 之外临时拉取）
npm install --no-audit --no-fund

# 交叉编译目标：在 Apple Silicon 上构建 Intel 产物时需要，已装过则无副作用
rustup target add "$RUST_TARGET" >/dev/null 2>&1 || true

# 前端依赖：tauri 的 beforeBuildCommand 只执行 npm run build，依赖要先装好。
# 用 ci 而不是 install，保证与 lockfile 逐字一致。
npm --prefix web ci

# tauri build 依次执行：beforeBuildCommand（构建 web/dist）→ cargo build
# → 打包 .app 与 .dmg（签名身份取 tauri.conf.json 里的 signingIdentity）
npx tauri build --target "$RUST_TARGET"

# 把产物收集到 dist-* 目录，发布工作流按这个约定取文件
BUNDLE_DIR="src-tauri/target/$RUST_TARGET/release/bundle"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp -R "$BUNDLE_DIR/macos/CC Analyzer.app" "$DIST_DIR/"
cp "$BUNDLE_DIR/dmg/"*.dmg "$DIST_DIR/"

echo
echo "产物："
ls -1 "$DIST_DIR"