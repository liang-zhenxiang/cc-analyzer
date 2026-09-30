#!/usr/bin/env bash
#
# build-intel-macos.sh —— 构建 Intel（x86_64）的 macOS 产物
#
# build-macos.sh 的薄封装：架构固定为 x86_64，省得每次手打参数。
# `.github/workflows/release.yml` 就是按无参方式调用它的。
#
# `--help` **在本脚本里只做转发**，不自备一份：帮助文本只有 build-macos.sh
# 那一份，在这里抄一遍会在上游增删选项时静默漂移（而两份不一致的帮助比没有
# 帮助更糟——它让人按错误的前提行动）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  -h|--help)
    # 转发之前先补一行「本脚本的预设」。转发来的帮助只有 build-macos.sh 的用法，
    # 看的人无从知道「不带参跑这个脚本构建的是 x86_64」——而这恰恰是他调用
    # 包装脚本时唯一需要知道的事。
    # 这一行只讲本脚本自己，不复制上游帮助的任何内容：帮助文本依旧只有一份。
    printf '（本脚本 = build-macos.sh x86_64：架构已固定，不接受架构参数）\n\n'
    exec "$SCRIPT_DIR/build-macos.sh" --help
    ;;
  "")        exec "$SCRIPT_DIR/build-macos.sh" x86_64 ;;
  *)
    # 不静默忽略。早先多余的参数会被无声丢掉，`build-intel-macos.sh aarch64`
    # 于是构建出 x86_64 产物而使用者以为 Apple Silicon 生效了。
    printf '不支持的参数：%s（本脚本不接受参数，架构固定为 x86_64）\n' "$1" >&2
    printf '如需其他架构，请直接用 ./scripts/build-macos.sh --help\n' >&2
    exit 2
    ;;
esac
