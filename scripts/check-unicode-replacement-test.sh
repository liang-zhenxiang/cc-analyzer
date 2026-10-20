#!/usr/bin/env bash
#
# check-unicode-replacement-test.sh —— check-unicode-replacement.sh 的自测
#
# 这里在临时 Git 仓库里构造文本、工作区未暂存修改和二进制夹具。坏字符由
# python3 在运行时生成，避免自测脚本自身被 U+FFFD 门禁命中。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CHECK="${SCRIPT_DIR}/check-unicode-replacement.sh"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-unicode-replacement-test.sh: 需要 python3\n' >&2
  exit 2
fi
if [[ ! -f "$CHECK" ]]; then
  printf 'check-unicode-replacement-test.sh: 找不到 %s\n' "$CHECK" >&2
  exit 2
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cca-unicode.XXXXXX")"
readonly WORK_DIR
trap 'rm -rf "$WORK_DIR"' EXIT

REPLACEMENT="$(python3 -c 'import sys; sys.stdout.write(chr(0xFFFD))')"
readonly REPLACEMENT

passed=0
failed=0

ok() {
  printf '  ✓ %s\n' "$1"
  passed=$((passed + 1))
}

bad() {
  printf '  ✗ %s\n' "$1" >&2
  failed=$((failed + 1))
}

new_repo() {
  local root="$1"
  mkdir -p "$root"
  git init -q "$root"
  git -C "$root" config user.name "unicode-gate-test"
  git -C "$root" config user.email "unicode-gate-test@example.invalid"
  git -C "$root" config core.autocrlf false
}

commit_all() {
  local root="$1"
  git -C "$root" add -A
  git -C "$root" commit -qm "fixture"
}

run_check() {
  local root="$1"
  set +e
  output="$("$CHECK" --root "$root" 2>&1)"
  status=$?
  set -e
}

expect_pass() {
  local root="$1" label="$2" needle="${3:-}"
  run_check "$root"
  if [[ "$status" -ne 0 ]]; then
    bad "${label}：本应通过，实得 exit ${status}"
    printf '%s\n' "$output" >&2
    return
  fi
  if [[ "$output" != *"0 个文件 / 0 处 U+FFFD"* ]]; then
    bad "${label}：缺少干净汇总"
    printf '%s\n' "$output" >&2
    return
  fi
  if [[ -n "$needle" && "$output" != *"$needle"* ]]; then
    bad "${label}：输出未包含「${needle}」"
    printf '%s\n' "$output" >&2
    return
  fi
  ok "$label"
}

expect_hit() {
  local root="$1" label="$2" needle="$3"
  run_check "$root"
  if [[ "$status" -ne 1 ]]; then
    bad "${label}：本应 exit 1，实得 exit ${status}"
    printf '%s\n' "$output" >&2
    return
  fi
  if [[ "$output" != *"$needle"* ]]; then
    bad "${label}：输出未包含「${needle}」"
    printf '%s\n' "$output" >&2
    return
  fi
  ok "$label"
}

expect_error() {
  local root="$1" label="$2" expected_status="$3" needle="$4"
  run_check "$root"
  if [[ "$status" -ne "$expected_status" ]]; then
    bad "${label}：本应 exit ${expected_status}，实得 exit ${status}"
    printf '%s\n' "$output" >&2
    return
  fi
  if [[ "$output" != *"$needle"* ]]; then
    bad "${label}：输出未包含「${needle}」"
    printf '%s\n' "$output" >&2
    return
  fi
  ok "$label"
}

printf '▶ check-unicode-replacement.sh 自测\n'

# a. 干净文本通过。
clean_repo="${WORK_DIR}/clean"
new_repo "$clean_repo"
printf '正常文本\n没有替换字符\n' >"${clean_repo}/clean.txt"
printf 'Markdown\n' >"${clean_repo}/说明.md"
printf 'minified\n' >"${clean_repo}/app.min.js"
printf '无扩展名文本\n' >"${clean_repo}/LICENSE"
mkdir -p "${clean_repo}/空 目录"
printf '中文路径与空格\n' >"${clean_repo}/空 目录/文件.txt"
commit_all "$clean_repo"
expect_pass "$clean_repo" "干净文本、Markdown、min.js、无扩展名与含空格路径通过" \
  "扫描 5 个已跟踪文本文件"

# b. 已跟踪文本注入 U+FFFD 后失败，且输出带文件与行号。
tracked_repo="${WORK_DIR}/tracked"
new_repo "$tracked_repo"
printf '第一行\n第二行\n' >"${tracked_repo}/tracked-bad.txt"
printf '第一行\r\n重复 %s 与 %s\r\n' "$REPLACEMENT" "$REPLACEMENT" \
  >"${tracked_repo}/空 格.md"
commit_all "$tracked_repo"
printf '第一行\n第二行含%s\n' "$REPLACEMENT" >"${tracked_repo}/tracked-bad.txt"
git -C "$tracked_repo" add -A
commit_all "$tracked_repo"
expect_hit "$tracked_repo" "已跟踪文本命中" "tracked-bad.txt:2: 1 处 U+FFFD"
expect_hit "$tracked_repo" "CRLF 同行多命中计数准确" "空 格.md:2: 2 处 U+FFFD"

# c. 已跟踪文件只在工作区改坏、没有暂存时也必须失败。
unstaged_repo="${WORK_DIR}/unstaged"
new_repo "$unstaged_repo"
printf '第一行\n第二行\n' >"${unstaged_repo}/unstaged-bad.txt"
commit_all "$unstaged_repo"
printf '第一行\n第二行含%s\n' "$REPLACEMENT" >"${unstaged_repo}/unstaged-bad.txt"
if ! git -C "$unstaged_repo" diff --cached --quiet -- unstaged-bad.txt; then
  bad "未暂存用例无效：夹具已经被暂存"
else
  expect_hit "$unstaged_repo" "仅未暂存修改命中" "unstaged-bad.txt:2: 1 处 U+FFFD"
fi

# d. PNG 扩展名与含 NUL 的二进制都不误报。
binary_repo="${WORK_DIR}/binary"
new_repo "$binary_repo"
printf 'PNG-header-%s' "$REPLACEMENT" >"${binary_repo}/image.png"
printf 'BMP-header-%s' "$REPLACEMENT" >"${binary_repo}/image.bmp"
printf 'text\0%s\0more' "$REPLACEMENT" >"${binary_repo}/binary.dat"
commit_all "$binary_repo"
expect_pass "$binary_repo" "扩展名与 NUL 二进制分别跳过" \
  "跳过 3 个二进制"

# e. 符号链接本身不是文本文件，不能跟随到仓库外读取目标内容。
symlink_repo="${WORK_DIR}/symlink"
new_repo "$symlink_repo"
printf '仓库外内容含 %s\n' "$REPLACEMENT" >"${WORK_DIR}/outside.txt"
ln -s "${WORK_DIR}/outside.txt" "${symlink_repo}/link.txt"
commit_all "$symlink_repo"
expect_pass "$symlink_repo" "符号链接不跟随外部目标" \
  "1 个符号链接"

# f. 非 Git 目录不能伪装成检查通过。
not_git="${WORK_DIR}/not-git"
mkdir -p "$not_git"
printf '正常文本\n' >"${not_git}/clean.txt"
expect_error "$not_git" "非 Git 目录返回 2" 2 "不是 Git 工作区"

# g. 嵌在父仓库里但不是工作树根目录时，不能把父仓库文件当成当前项目。
parent_repo="${WORK_DIR}/parent"
new_repo "$parent_repo"
printf '父仓库文件\n' >"${parent_repo}/parent.txt"
commit_all "$parent_repo"
mkdir -p "${parent_repo}/nested"
printf '嵌套目录未跟踪文本\n' >"${parent_repo}/nested/untracked.txt"
expect_error "${parent_repo}/nested" "嵌套目录不假绿" 2 \
  "不是 Git 工作树根目录"

# h. 缺少 git 时必须明确返回 2，不能抛出 Python traceback。
tool_dir="${WORK_DIR}/tools"
mkdir -p "$tool_dir"
ln -s "$(command -v bash)" "${tool_dir}/bash"
ln -s "$(command -v python3)" "${tool_dir}/python3"
set +e
output="$(env -i PATH="$tool_dir" "$CHECK" --root "$clean_repo" 2>&1)"
status=$?
set -e
if [[ "$status" -ne 2 ]]; then
  bad "缺少 git 时本应 exit 2，实得 exit ${status}"
  printf '%s\n' "$output" >&2
elif [[ "$output" != *"无法执行 git"* ]]; then
  bad "缺少 git 时没有明确说明无法确定已跟踪文件"
  printf '%s\n' "$output" >&2
else
  ok "缺少 git 时明确返回 2"
fi

printf '\n通过 %d · 失败 %d\n' "$passed" "$failed"
if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-unicode-replacement.sh 自测全部通过\n'
