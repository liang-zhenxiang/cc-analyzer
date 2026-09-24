#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="CC Analyzer"
BINARY_NAME="cc-analyzer"
ARCH="${1:-$(uname -m)}"

case "$ARCH" in
  x86_64|amd64)
    ARCH="x86_64"
    DIST_DIR="$ROOT_DIR/dist-intel"
    DMG_SUFFIX="x64"
    ;;
  aarch64|arm64)
    ARCH="aarch64"
    DIST_DIR="$ROOT_DIR/dist-arm64"
    DMG_SUFFIX="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH (use x86_64 or aarch64)" >&2
    exit 2
    ;;
esac

RUST_TARGET="${ARCH}-apple-darwin"
APP_DIR="$DIST_DIR/$APP_NAME.app"
DMG_PATH="$DIST_DIR/${APP_NAME// /_}_$DMG_SUFFIX.dmg"

cd "$ROOT_DIR"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to build the web UI" >&2
  exit 1
fi

npm --prefix web ci
npm --prefix web run build

if command -v rustup >/dev/null 2>&1; then
  rustup target add "$RUST_TARGET"
fi

cargo build --release --manifest-path src-tauri/Cargo.toml --target "$RUST_TARGET"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "src-tauri/target/$RUST_TARGET/release/$BINARY_NAME" "$APP_DIR/Contents/MacOS/"
cp packaging/macos/Info.plist "$APP_DIR/Contents/Info.plist"
cp packaging/macos/icon.icns "$APP_DIR/Contents/Resources/icon.icns"

if [[ "$ARCH" == "aarch64" ]]; then
  plutil -replace LSMinimumSystemVersion -string "11.0" "$APP_DIR/Contents/Info.plist"
fi

codesign --force --deep --sign - "$APP_DIR"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$APP_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "Created $APP_DIR"
echo "Created $DMG_PATH"
