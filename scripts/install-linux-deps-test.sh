#!/usr/bin/env bash
#
# install-linux-deps.sh 的自测：用假 apt-get 模拟镜像抖动，锁住三件事——
#   1. 一次失败会整轮重试，而不是把一次超时当失败；
#   2. 重试次数用尽后必须以非零退出（不能静默放行）；
#   3. 包清单为空时当场失败，不去执行一个没有参数的 install。
#
# 不联网、不调用 sudo、不写 /etc：SUDO 置空、APT_ARCHIVES_DIR 不设，
# 假命令只把调用记录到临时文件里。
#
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target="${script_dir}/install-linux-deps.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/cca-apt-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

failures=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() {
  printf '  ✗ %s\n' "$1" >&2
  failures=$((failures + 1))
}

# 假 apt-get：前 FAIL_TIMES 次调用返回 100，其余返回 0；每次调用记账。
cat >"${work}/fake-apt" <<'FAKE'
#!/usr/bin/env bash
# 调用次数 = 已记录的行数 + 1（只数行，不把参数读进算术表达式）。
previous="$(wc -l <"$CALL_FILE" 2>/dev/null || true)"
previous="${previous//[[:space:]]/}"
call=$(( ${previous:-0} + 1 ))
printf '%s %s\n' "$call" "$*" >> "$CALL_FILE"
if (( call <= ${FAIL_TIMES:-0} )); then
  exit 100
fi
exit 0
FAKE
chmod +x "${work}/fake-apt"

printf 'libgtk-3-dev\n# comment line\nlibrsvg2-dev\n' >"${work}/packages.txt"
: >"${work}/empty.txt"

run_case() {
  local fail_times="$1" attempts="$2" packages_file="$3" call_file="$4"
  : >"$call_file"
  CALL_FILE="$call_file" FAIL_TIMES="$fail_times" \
    SUDO='' APT_GET="${work}/fake-apt" APT_ATTEMPTS="$attempts" APT_RETRY_SLEEP=0 \
    PACKAGES_FILE="$packages_file" \
    bash "$target" >/dev/null 2>"${work}/stderr.log" &&
    return 0 || return 1
}

# 1) 一次就成功：update + install 各一次。
if run_case 0 3 "${work}/packages.txt" "${work}/calls-ok.log"; then
  count="$(wc -l <"${work}/calls-ok.log" | tr -d ' ')"
  if [[ "$count" == "2" ]] &&
    grep -q '^1 .*update' "${work}/calls-ok.log" &&
    grep -q '^2 .*install -y' "${work}/calls-ok.log" &&
    grep -q 'libgtk-3-dev' "${work}/calls-ok.log" &&
    grep -q 'librsvg2-dev' "${work}/calls-ok.log"; then
    pass "一次成功：update 与 install 各调用一次，包名按清单传入"
  else
    fail "一次成功时的调用序列不对（${count} 次）"
    cat "${work}/calls-ok.log" >&2
  fi
else
  fail "一次成功时脚本却失败了"
  cat "${work}/stderr.log" >&2
fi

# 2) 前两次失败、第三次成功：必须整轮重试并最终成功。
if run_case 2 3 "${work}/packages.txt" "${work}/calls-retry.log"; then
  count="$(wc -l <"${work}/calls-retry.log" | tr -d ' ')"
  # 第 1 轮 update 失败、第 2 轮 update 失败、第 3 轮 update + install 成功 = 4 次
  if [[ "$count" == "4" ]]; then
    pass "两次失败后整轮重试，第 3 次成功（共 4 次调用）"
  else
    fail "重试路径的调用次数不对：期望 4，实际 ${count}"
    cat "${work}/calls-retry.log" >&2
  fi
else
  fail "前两次失败后应重试成功，脚本却退出了非零"
  cat "${work}/stderr.log" >&2
fi

# 3) 一直失败：必须在用尽尝试次数后非零退出。
if run_case 99 2 "${work}/packages.txt" "${work}/calls-fail.log"; then
  fail "镜像持续不可用时脚本却成功退出（会把失败伪装成通过）"
else
  count="$(wc -l <"${work}/calls-fail.log" | tr -d ' ')"
  if [[ "$count" == "2" ]]; then
    pass "持续失败：用尽 2 次尝试后非零退出"
  else
    fail "持续失败时的调用次数不对：期望 2，实际 ${count}"
  fi
fi

# 4) 空清单：不执行任何 apt 调用，直接失败。
if run_case 0 3 "${work}/empty.txt" "${work}/calls-empty.log"; then
  fail "空包清单却成功退出"
else
  count="$(wc -l <"${work}/calls-empty.log" | tr -d ' ')"
  if [[ "$count" == "0" ]]; then
    pass "空包清单：不调用 apt，直接失败"
  else
    fail "空包清单仍调用了 apt（${count} 次）"
  fi
fi

if ((failures > 0)); then
  printf '\n%d 项失败\n' "$failures" >&2
  exit 1
fi
printf '\n安装脚本自测全部通过\n'
