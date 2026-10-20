#!/usr/bin/env bash
#
# check-unicode-replacement.sh —— 已跟踪文本文件不得含 U+FFFD
#
# 文件集来自 git ls-files，内容读工作区而不是 index/blob：编辑到一半、尚未
# 暂存的坏字符也必须被发现。图片等明显二进制按扩展名跳过，其余文件再用 NUL
# 字节探测兜底。

set -euo pipefail

usage() {
  printf '用法：%s [--root <目录>]\n' "${0##*/}" >&2
}

root="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      if [[ $# -lt 2 || -z "$2" ]]; then
        usage
        exit 2
      fi
      root="$2"
      shift 2
      ;;
    *)
      printf '未知参数：%s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-unicode-replacement.sh: 需要 python3\n' >&2
  exit 2
fi
if [[ ! -d "$root" ]]; then
  printf '错误：%s 不是目录，无法确定已跟踪文件。\n' "$root" >&2
  exit 2
fi

python3 - "$root" <<'PY'
from pathlib import Path
import os
import stat
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
try:
    inside = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--is-inside-work-tree"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
except OSError as exc:
    print(f"错误：无法执行 git（{exc}），不能确定已跟踪文件。", file=sys.stderr)
    raise SystemExit(2)
if inside.returncode != 0 or inside.stdout.strip() != "true":
    print(
        f"错误：{root} 不是 Git 工作区，无法确定已跟踪文件。",
        file=sys.stderr,
    )
    raise SystemExit(2)

try:
    prefix = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--show-prefix"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
except OSError as exc:
    print(f"错误：无法执行 git（{exc}），不能确定已跟踪文件。", file=sys.stderr)
    raise SystemExit(2)
if prefix.returncode != 0:
    print(f"错误：{root} 无法解析 Git 工作树根目录。", file=sys.stderr)
    raise SystemExit(2)
if prefix.stdout.strip():
    print(
        f"错误：{root} 不是 Git 工作树根目录，"
        "不能把父仓库的已跟踪文件当成当前项目。",
        file=sys.stderr,
    )
    raise SystemExit(2)

try:
    listed = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
except OSError as exc:
    print(f"错误：无法执行 git（{exc}），不能确定已跟踪文件。", file=sys.stderr)
    raise SystemExit(2)
if listed.returncode != 0:
    sys.stderr.buffer.write(listed.stderr)
    print("错误：git ls-files 失败，无法确定已跟踪文件。", file=sys.stderr)
    raise SystemExit(2)

replacement = b"\xef\xbf\xbd"
binary_extensions = {
    ".png",
    ".ico",
    ".icns",
    ".bmp",
    ".tif",
    ".tiff",
    ".avif",
    ".heic",
    ".heif",
    ".psd",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
    ".gz",
    ".bz2",
    ".xz",
    ".tar",
    ".7z",
    ".rar",
    ".dmg",
    ".exe",
    ".dll",
    ".dylib",
    ".so",
    ".o",
    ".a",
    ".class",
    ".jar",
    ".wasm",
    ".pyc",
    ".sqlite",
    ".sqlite3",
    ".db",
    ".parquet",
    ".avro",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".m4a",
    ".ogg",
    ".mp4",
    ".webm",
    ".mov",
    ".mkv",
    ".avi",
}

scanned_files = 0
hit_files = 0
hit_count = 0
binary_skipped = 0
symlink_skipped = 0
missing_skipped = 0
special_skipped = 0
read_errors = []

for raw_name in listed.stdout.split(b"\0"):
    if not raw_name:
        continue
    name = os.fsdecode(raw_name)
    path = root / name
    if path.suffix.lower() in binary_extensions:
        binary_skipped += 1
        continue
    try:
        file_stat = path.lstat()
    except FileNotFoundError:
        missing_skipped += 1
        continue
    except OSError as exc:
        read_errors.append((name, str(exc)))
        continue
    if stat.S_ISLNK(file_stat.st_mode):
        symlink_skipped += 1
        continue
    if not stat.S_ISREG(file_stat.st_mode):
        special_skipped += 1
        continue
    try:
        data = path.read_bytes()
    except OSError as exc:
        read_errors.append((name, str(exc)))
        continue
    if b"\0" in data:
        binary_skipped += 1
        continue

    scanned_files += 1
    if replacement not in data:
        continue

    hit_files += 1
    for line_number, line in enumerate(data.splitlines(), 1):
        count = line.count(replacement)
        if count:
            hit_count += count
            print(f"{name}:{line_number}: {count} 处 U+FFFD")

if read_errors:
    for name, message in read_errors:
        print(f"{name}: 无法读取：{message}", file=sys.stderr)
    print("错误：存在无法读取的已跟踪文件，不能判定检查通过。", file=sys.stderr)
    raise SystemExit(1)

skipped = (
    f"（跳过 {binary_skipped} 个二进制、{symlink_skipped} 个符号链接、"
    f"{missing_skipped} 个缺失文件、{special_skipped} 个特殊文件）"
)
if hit_count:
    print(
        f"扫描 {scanned_files} 个已跟踪文本文件："
        f"{hit_files} 个文件 / {hit_count} 处 U+FFFD{skipped}"
    )
    raise SystemExit(1)

print(
    f"扫描 {scanned_files} 个已跟踪文本文件："
    f"0 个文件 / 0 处 U+FFFD{skipped}"
)
PY
