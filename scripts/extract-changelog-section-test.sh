#!/usr/bin/env bash
#
# extract-changelog-section-test.sh —— `extract-changelog-section.sh` 的自测
#
# 为什么值得单独测：这一步的输出直接进**发布说明**，而它的失败是静默的——
# 抽不到内容只会走降级分支（「本版本未在 CHANGELOG.md 中单独登记」），发布照常
# 成功，只是说明里少了维护者写的那一段。这种「发布成功了，但内容悄悄丢了」正是
# 最该用测试钉住的东西。
#
# 两条路径都要覆盖：稳定版走 `## [<version>]` 段；先行版走 `[Unreleased]` 里
# 那条 `- **先行版 v<version>`。另外覆盖几个容易错的边界：版本号前缀（找
# `1.3.0-beta.1` 不该命中 `1.3.0-beta.10`）、晋升后条目被归档到版本段里、
# 以及「两者都在时以版本段为准」。
#
# 用法：./scripts/extract-changelog-section-test.sh
# 退出码：0 全部通过；1 有用例失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly TARGET="${SCRIPT_DIR}/extract-changelog-section.sh"
readonly FIXTURE_DIR="${SCRIPT_DIR}/tests/fixtures/changelog-section"
readonly REAL_CHANGELOG="${SCRIPT_DIR}/../CHANGELOG.md"

# 单个用例的秒级上限。正常实现是毫秒级（整份套件 <1 s），所以这个值给得
# 很宽松——它要抓的不是「慢」，是「二次复杂度」，那种情况差着好几个数量级。
readonly CASE_BUDGET=20
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

# 用例清单。显式列出而不是 glob：每条都要有人写清它覆盖什么。
# 「清单里没有、目录里有」会在下面被断言为失败——静默漏跑的夹具看起来像是覆盖到了。
declare -a CASES=(
  "stable-section:稳定版：取 ## [1.2.3] 段，不含相邻版本"
  "beta-bullet:先行版：取 [Unreleased] 里那一条（含缩进子条目）"
  "beta-bullet-not-first:同上的条目排在第三条，也只取它自己"
  "beta-bullet-archived:晋升后条目被归档进版本段，仍然找得到"
  "stable-wins:版本段与先行版条目同时存在时，以版本段为准"
  "prefix-guard:找 1.3.0-beta.1 不该命中 1.3.0-beta.10"
  "missing:两处都没有 → 空输出、退出码 3"
  "large-multibyte:13 KB 中文段落的「非空判定」不会退化成二次复杂度（#210）"
)

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_BOLD=""; C_RESET=""
fi

if [[ ! -x "$TARGET" ]]; then
  printf '%s被测脚本不存在或不可执行：%s%s\n' "$C_RED" "$TARGET" "$C_RESET" >&2
  exit 1
fi

printf '%s' "$C_BOLD"
cat <<'BANNER'
╭──────────────────────────────────────────────╮
│  CHANGELOG 抽段 · 自测                        │
╰──────────────────────────────────────────────╯
BANNER
printf '%s' "$C_RESET"

PASSED=0
FAILED=0
declare -a FAILED_NAMES=()

# 「这段是不是只有空白」。理由与 `extract-changelog-section.sh` 里同名函数一致：
# bash 3.2 在 `"${var//[[:space:]]/}"` 上对多字节是**二次**的（30 KB 要两分钟），
# 而这里将来可能比对更大的夹具输出，所以从一开始就不要写那种形式。
has_non_blank() {
  grep -q '[^[:space:]]' <<<"$1"
}

# 便携超时：macOS 自带**没有** `timeout(1)`（那是 GNU coreutils），而
# `perl`/`gtimeout` 又要求额外安装。这里用轮询实现，够用且零依赖。
#
# 为什么这个测试**必须**有界：被测的是一段 bash 展开，它在 bash 3.2 上对多字节
# 是**二次**复杂度——不是「慢一点」，而是 30 KB 要两分钟、59 KB 要十几分钟。
# 没有上界的话，回归不表现为「失败」，而表现为「CI 卡到超时」，那时看到的是
# 「作业超时」而不是「哪个用例慢了」，排查要绕远路。
#
# 用法：run_bounded <秒> <输出文件> <命令...>
run_bounded() {
  local budget="$1" out="$2"; shift 2
  "$@" >"$out" 2>/dev/null &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if (( waited >= budget * 10 )); then
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124                      # 与 GNU timeout 的约定一致
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null
  return $?
}

ok()  { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; PASSED=$((PASSED + 1)); }
bad() { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"; FAILED=$((FAILED + 1)); FAILED_NAMES+=("$1"); }

# ---------------------------------------------------------------------------
# 全局对照：用例清单与夹具目录必须一一对应（两个方向都查）
# ---------------------------------------------------------------------------
declared="$(printf '%s\n' "${CASES[@]}" | cut -d: -f1 | sort)"
present="$(find "$FIXTURE_DIR" -name '*.in.md' -exec basename {} .in.md \; 2>/dev/null | sort)"

if [[ "$declared" != "$present" ]]; then
  printf '\n%s✗ 用例清单与夹具目录不一致%s\n' "$C_RED" "$C_RESET"
  printf '  只在清单里：%s\n' "$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$present") | tr '\n' ' ')"
  printf '  只在目录里：%s\n' "$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$present") | tr '\n' ' ')"
  exit 1
fi

missing=""
for spec in "${CASES[@]}"; do
  name="${spec%%:*}"
  [[ -f "${FIXTURE_DIR}/${name}.version" ]] || missing="${missing} ${name}.version"
  [[ -f "${FIXTURE_DIR}/${name}.expected.md" ]] || missing="${missing} ${name}.expected.md"
done
if [[ -n "$missing" ]]; then
  printf '\n%s✗ 以下用例缺文件：%s%s\n' "$C_RED" "$missing" "$C_RESET" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 逐用例：比对 stdout 与退出码
#   - 期望非空 → 退出码必须是 0
#   - 期望为空 → 退出码必须是 3（「没找到」是**明确信号**，不是普通错误；
#     发布工作流靠它区分「降级」与「脚本坏了」）
# ---------------------------------------------------------------------------
for spec in "${CASES[@]}"; do
  name="${spec%%:*}"
  description="${spec#*:}"
  version="$(tr -d '[:space:]' <"${FIXTURE_DIR}/${name}.version")"

  actual=""
  status=0
  run_bounded "$CASE_BUDGET" "$TMP_OUT" "$TARGET" "$version" "${FIXTURE_DIR}/${name}.in.md" || status=$?
  actual="$(cat "$TMP_OUT")"
  if [[ "$status" == "124" ]]; then
    bad "${name}：${description}（超过 ${CASE_BUDGET} 秒上限——疑似 bash 展开的二次复杂度回归）"
    continue
  fi
  expected="$(cat "${FIXTURE_DIR}/${name}.expected.md")"

  if ! has_non_blank "$expected"; then
    if [[ "$status" == "3" ]] && ! has_non_blank "$actual"; then
      ok "${name}：${description}"
    else
      bad "${name}：${description}（期望空输出 + 退出码 3，实际退出码 ${status}、输出 ${#actual} 字符）"
    fi
  elif [[ "$status" != "0" ]]; then
    bad "${name}：${description}（期望退出码 0，实际 ${status}）"
  elif [[ "$actual" == "$expected" ]]; then
    ok "${name}：${description}"
  else
    bad "${name}：${description}（输出与夹具不一致）"
    printf '      期望：%s\n' "${expected%%$'\n'*}"
    printf '      实际：%s\n' "${actual%%$'\n'*}"
  fi
done

# ---------------------------------------------------------------------------
# 真实 CHANGELOG 冒烟：夹具是我想象的形状，真文件才是它每天要读的东西。
# 取一个**不会再变**的稳定版（0.9.0）与当前最新先行版（0.13.0-beta.1）各跑一次。
# ---------------------------------------------------------------------------
real_stable=""
if run_bounded "$CASE_BUDGET" "$TMP_OUT" "$TARGET" 0.9.0 "$REAL_CHANGELOG" &&
  real_stable="$(cat "$TMP_OUT")" && [[ -n "$real_stable" ]]; then
  ok "真实文件：稳定版 0.9.0 能抽出段落（$(printf '%s\n' "$real_stable" | wc -l | tr -d ' ') 行）"
else
  bad "真实文件：稳定版 0.9.0 抽不到段落"
fi

real_beta=""
if run_bounded "$CASE_BUDGET" "$TMP_OUT" "$TARGET" 0.13.0-beta.1 "$REAL_CHANGELOG" &&
  real_beta="$(cat "$TMP_OUT")" && [[ "$real_beta" == *"先行版 v0.13.0-beta.1"* ]]; then
  ok "真实文件：先行版 0.13.0-beta.1 抽到的是那条主题说明（不是降级）"
else
  bad "真实文件：先行版 0.13.0-beta.1 没抽到主题说明"
fi

printf '\n'
if [[ "$FAILED" == "0" ]]; then
  printf '%s通过 %s · 失败 0%s\n' "$C_GREEN" "$PASSED" "$C_RESET"
  exit 0
fi
printf '%s通过 %s · 失败 %s%s\n' "$C_RED" "$PASSED" "$FAILED" "$C_RESET"
printf '失败用例：%s\n' "${FAILED_NAMES[*]}"
exit 1
