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

usage() {
  cat <<'EOF'
build-macos.sh —— 构建 macOS 产物（.app + .dmg），走 Tauri 官方打包流程

用法：
  ./scripts/build-macos.sh              # 当前机器架构
  ./scripts/build-macos.sh x86_64       # Intel（在 Apple Silicon 上交叉编译）
  ./scripts/build-macos.sh aarch64      # Apple Silicon
  -h, --help                            # 显示帮助

产物：
  x86_64  → dist-intel/
  aarch64 → dist-arm64/

环境变量 TAURI_BUILD_FEATURES 会透传给 tauri build 的 --features。真机 GUI
测试需要它带 gui-capture（用 ./scripts/gui-test.sh --build 会自动带上）；
发布产物**不带**任何 feature，所以默认不传。
EOF
}

ARCH="${1:-$(uname -m)}"

case "$ARCH" in
  # 没有这一支时 --help 会掉进下面的 unknown 分支，报「不支持的架构：--help」
  # ——使用者以为自己在传架构。帮助走 usage 并 exit 0，与 check-commit-msg.sh
  # 的处置一致。注意别把 unknown 分支的文案与退出码 2 一并改掉：那条是给
  # 拼错架构用的，行为正确（.trellis/spec/testing/pitfalls.md 第 2 节记着它）。
  -h|--help)
    usage
    exit 0
    ;;
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
    echo "不支持的架构：${ARCH}（请用 x86_64 或 aarch64）" >&2
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
# 可选的 cargo feature 透传。真机 GUI 测试用 `TAURI_BUILD_FEATURES=gui-capture`
# 让应用能把自己的 webview 渲染成图（见 scripts/gui-test.sh）。
# **默认不传**——发布产物里不该带这段代码。
# --config 叠加层经 TAURI_BUILD_CONFIG 透传（本地构建用它关掉更新包签名：
# 私钥只在 CI 的 Secrets 里，本地没有私钥，带 updater 产物的构建必失败）。
CONFIG_ARGS=()
if [[ -n "${TAURI_BUILD_CONFIG:-}" ]]; then
  CONFIG_ARGS=(--config "$TAURI_BUILD_CONFIG")
fi
FEATURE_ARGS=()
if [[ -n "${TAURI_BUILD_FEATURES:-}" ]]; then
  echo "启用 cargo feature：${TAURI_BUILD_FEATURES}" >&2
  FEATURE_ARGS=(--features "$TAURI_BUILD_FEATURES")
fi
# bash 3.2 的 set -u 下空数组展开是 unbound variable——先判长度再拼。
BUILD_ARGS=(--target "$RUST_TARGET")
if [[ ${#FEATURE_ARGS[@]} -gt 0 ]]; then
  BUILD_ARGS+=("${FEATURE_ARGS[@]}")
fi
if [[ ${#CONFIG_ARGS[@]} -gt 0 ]]; then
  BUILD_ARGS+=("${CONFIG_ARGS[@]}")
fi
npx tauri build "${BUILD_ARGS[@]}"

# 把产物收集到 dist-* 目录，发布工作流按这个约定取文件
BUNDLE_DIR="src-tauri/target/$RUST_TARGET/release/bundle"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp -R "$BUNDLE_DIR/macos/CC Analyzer.app" "$DIST_DIR/"
cp "$BUNDLE_DIR/dmg/"*.dmg "$DIST_DIR/"
# 更新包与签名：tauri 在 bundle/macos/ 下产出 .app.tar.gz 与 .sig
# （createUpdaterArtifacts 开启时；本地 overlay 构建会跳过，nullglob 兜底）。
shopt -s nullglob
cp "$BUNDLE_DIR/macos/"*.app.tar.gz "$DIST_DIR/" 2>/dev/null || true
cp "$BUNDLE_DIR/macos/"*.sig "$DIST_DIR/" 2>/dev/null || true

# 产物文件名规范化：Tauri 用 productName（"CC Analyzer"，含空格）命名文件，
# 而 GitHub 在上传发布产物时会把空格替换成点——于是本地、文档、用户下载到
# 的三种名字互相对不上。统一改成连字符，本地与发布产物同名。
# （.app 目录名不改：它是应用本身的名字，不是分发文件。）
shopt -s nullglob
for f in "$DIST_DIR"/*\ *.dmg "$DIST_DIR"/*\ *.tar.gz "$DIST_DIR"/*\ *.sig; do
  mv "$f" "${f// /-}"
done

echo
echo "产物："
ls -1 "$DIST_DIR"