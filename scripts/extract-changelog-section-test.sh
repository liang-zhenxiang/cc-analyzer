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
  actual="$("$TARGET" "$version" "${FIXTURE_DIR}/${name}.in.md" 2>/dev/null)" || status=$?
  expected="$(cat "${FIXTURE_DIR}/${name}.expected.md")"

  if [[ -z "${expected//[[:space:]]/}" ]]; then
    if [[ "$status" == "3" && -z "${actual//[[:space:]]/}" ]]; then
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
if real_stable="$("$TARGET" 0.9.0 "$REAL_CHANGELOG" 2>/dev/null)" && [[ -n "$real_stable" ]]; then
  ok "真实文件：稳定版 0.9.0 能抽出段落（$(printf '%s\n' "$real_stable" | wc -l | tr -d ' ') 行）"
else
  bad "真实文件：稳定版 0.9.0 抽不到段落"
fi

if real_beta="$("$TARGET" 0.13.0-beta.1 "$REAL_CHANGELOG" 2>/dev/null)" &&
  [[ "$real_beta" == *"先行版 v0.13.0-beta.1"* ]]; then
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
