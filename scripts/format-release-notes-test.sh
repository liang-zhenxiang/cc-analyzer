#!/usr/bin/env bash
#
# format-release-notes-test.sh —— format-release-notes.sh 的自测
#
# 为什么要有它：转换逻辑如果只写在 release.yml 的 `run:` 里，唯一的验证方式就是
# 「发一次版，用人眼看发布说明对不对」——而发布是低频、且已经对用户可见的动作。
# 把转换抽成脚本、把每种输入固定成夹具，这层校验才每次 CI 都跑得到
# （见 .github/workflows/ci.yml 的 release-notes-test job）。
#
# 夹具：scripts/tests/fixtures/release-notes/<用例>.in.md / <用例>.expected.md
#   expected 是**人工核对后写下的**，不是脚本生成的快照——脚本自己生成的
#   快照会让「脚本坏了」与「预期变了」长得一模一样。
#
# 每条用例断言七件事：
#   ① 文件入参与管道入参都应以 0 退出（发布说明必须能降级，任何内容都不该阻断发布）
#   ② 输出与 expected 逐字一致
#   ③ 两种入参路径结果一致
#   ④ 幂等：把输出再喂回去一次，结果逐字不变（tag 重推会触发第二次发布工作流）
#   ⑤ 输出里不残留英文模板串——用被测脚本自己的 `--check`，不在这里另抄一份正则
#   ⑥ 空输入的输入必须真的是空的输入
#   ⑦ 非豁免用例必须「真的变了」，否则这条用例什么也没测
# 另有两条全局对照，防止上面这些断言恒真，见脚本内注释。
#
# 用法：
#   ./scripts/format-release-notes-test.sh      # 跑全部用例（不接受参数）
#
# **不提供 --help**，并把任何参数当作错误拒掉：本脚本没有选项可讲，
# 与 scripts/lint.sh 的处置一致（拒绝比静默忽略诚实）。

set -euo pipefail

if [[ $# -gt 0 ]]; then
  printf 'format-release-notes-test.sh 不接受参数（收到：%s）。用法：./scripts/format-release-notes-test.sh\n' "$1" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

readonly TARGET="${SCRIPT_DIR}/format-release-notes.sh"
readonly FIXTURE_DIR="${SCRIPT_DIR}/tests/fixtures/release-notes"

# 用例清单。显式列出而不是直接 glob：每条都要有人写清它覆盖什么。
# 清单与夹具目录的一致性在下面被断言——漏加一条或多出一个夹具都会红，
# 「夹具加了但从来没被跑过」是这层测试最容易出的问题。
declare -a CASES=(
  "typical:典型 PR 清单：中文分类标题 + 行尾贡献者句式 + 对比链接"
  "contributors:含 New Contributors 段"
  "changelog-only:缺段：只有对比链接"
  "changelog-section:CHANGELOG 手写段：六个固定分类标题（Added/Changed/…）转中文"
  "already-zh:已是中文，逐字返回（幂等）"
  "empty:空输入：输出为空且退出码 0"
)

# 这几条用例的输入本来就应该等于输出，不做「转换确实生效」的断言。
# 两侧留空格，用 `*" ${name} "*` 匹配，避免前缀误命中。
readonly NOOP_CASES=" already-zh empty "

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_BOLD=""; C_RESET=""
fi

if [[ ! -f "$TARGET" ]]; then
  printf '%s被测脚本不存在：%s%s\n' "$C_RED" "$TARGET" "$C_RESET" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/format-release-notes-test.XXXXXX")"
readonly WORK_DIR
trap 'rm -rf "$WORK_DIR"' EXIT

printf '%s' "$C_BOLD"
cat <<'BANNER'
╭──────────────────────────────────────────────╮
│  发布说明转换 · 自测                          │
╰──────────────────────────────────────────────╯
BANNER
printf '%s' "$C_RESET"

PASSED=0
FAILED=0
declare -a FAILED_NAMES=()

# ---------------------------------------------------------------------------
# 全局对照 1：用例清单与夹具目录必须一一对应
#
# 方向是双向的：清单里有、目录里没有 → 用例跑不起来；目录里有、清单里没有
# → 那个夹具**从来没被跑过**，而它看起来像是覆盖到了什么。
# ---------------------------------------------------------------------------
declared="$(printf '%s\n' "${CASES[@]}" | cut -d: -f1 | sort)"
present="$(find "$FIXTURE_DIR" -name '*.in.md' -exec basename {} .in.md \; 2>/dev/null | sort)"

if [[ "$declared" != "$present" ]]; then
  printf '\n%s✗ 用例清单与夹具目录不一致%s\n' "$C_RED" "$C_RESET"
  printf '  夹具目录：%s\n' "$FIXTURE_DIR"
  printf '  只在清单里：%s\n' "$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$present") | tr '\n' ' ')"
  printf '  只在目录里：%s\n' "$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$present") | tr '\n' ' ')"
  exit 1
fi

# 每个用例都必须有 expected；缺了就不能靠逐字比对，也就不该算通过
missing=""
for spec in "${CASES[@]}"; do
  name="${spec%%:*}"
  [[ -f "${FIXTURE_DIR}/${name}.expected.md" ]] || missing="${missing} ${name}"
done
if [[ -n "$missing" ]]; then
  printf '\n%s✗ 以下用例缺少 .expected.md：%s%s\n' "$C_RED" "$missing" "$C_RESET" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 全局对照 2：`--check` 必须在**原始夹具**上真的报错
#
# 没有这条，第 ⑤ 条断言就是恒真的——一个写错的正则同样「什么都不报」，
# 而它会让人以为英文模板串已经绝迹了。用被测脚本自己的 --check（而不是在这里
# 另写一份 grep）来对照：验的是它的真实行为，不是我们对它的想象。
# 至少四个夹具（typical / contributors / changelog-only / changelog-section）
# 含英文模板串。
# ---------------------------------------------------------------------------
english_fixtures=0
while IFS= read -r f; do
  if ! "$TARGET" --check "$f" >/dev/null 2>&1; then
    english_fixtures=$((english_fixtures + 1))
  fi
done < <(find "$FIXTURE_DIR" -name '*.in.md')

if [[ "$english_fixtures" -lt 4 ]]; then
  printf '\n%s✗ --check 在原始夹具上只报了 %d 个（应至少 4 个）%s\n' \
    "$C_RED" "$english_fixtures" "$C_RESET" >&2
  printf '  第 ⑤ 条断言因此形同虚设：它报「没有英文模板串」可能只是检测式没匹配上。\n' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 逐条用例
# ---------------------------------------------------------------------------
for spec in "${CASES[@]}"; do
  name="${spec%%:*}"
  desc="${spec#*:}"

  printf '\n%s▶ %s%s —— %s\n' "$C_BOLD" "$name" "$C_RESET" "$desc"

  in_file="${FIXTURE_DIR}/${name}.in.md"
  expected="${FIXTURE_DIR}/${name}.expected.md"
  actual="${WORK_DIR}/${name}.actual.md"
  from_stdin="${WORK_DIR}/${name}.stdin.md"
  idempotent="${WORK_DIR}/${name}.idempotent.md"

  case_problems=""
  # 追加一行问题描述。用函数改全局而不是子 shell——子 shell 里改的传不回来。
  note_problem() {
    case_problems="${case_problems}    · $1"$'\n'
  }

  # —— ① 文件入参：退出码必须为 0 ——
  rc=0
  "$TARGET" "$in_file" > "$actual" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    note_problem "文件入参以 ${rc} 退出（任何内容都应为 0，发布说明必须能降级）"
  fi

  # —— ② 与 expected 逐字一致 ——
  if ! diff -u "$expected" "$actual" > "${WORK_DIR}/${name}.diff"; then
    note_problem "输出与 ${name}.expected.md 不一致（- 为预期，+ 为实际）："
    case_problems="${case_problems}$(sed 's/^/      /' "${WORK_DIR}/${name}.diff")"$'\n'
  fi

  # —— ③ 管道入参与文件入参结果一致 ——
  rc=0
  "$TARGET" < "$in_file" > "$from_stdin" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    note_problem "管道入参以 ${rc} 退出"
  elif ! diff -u "$actual" "$from_stdin" > "${WORK_DIR}/${name}.stdin.diff"; then
    note_problem "管道入参与文件入参的结果不同："
    case_problems="${case_problems}$(sed 's/^/      /' "${WORK_DIR}/${name}.stdin.diff")"$'\n'
  fi

  # —— ④ 幂等：把输出再喂回去 ——
  # 空文件同样要过这一关（empty 用例的 actual 是空文件），所以不能加 -s 之类的守卫。
  rc=0
  "$TARGET" "$actual" > "$idempotent" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    note_problem "把输出再喂回去时以 ${rc} 退出"
  elif ! diff -u "$actual" "$idempotent" > "${WORK_DIR}/${name}.idem.diff"; then
    note_problem "转换不幂等——tag 重推触发第二次发布时会把已中文化的说明再改一遍："
    case_problems="${case_problems}$(sed 's/^/      /' "${WORK_DIR}/${name}.idem.diff")"$'\n'
  fi

  # —— ⑤ 输出里不得残留英文模板串 ——
  # 用被测脚本自己的 --check：检测式只有脚本里那一份，这里不另抄一遍
  # （另抄的那份不会跟着改，而它恰好是「断言是否还有意义」的那一半）。
  if ! "$TARGET" --check "$actual" > "${WORK_DIR}/${name}.en"; then
    note_problem "输出里仍有英文模板串（--check 以 1 退出）："
    case_problems="${case_problems}$(sed 's/^/      /' "${WORK_DIR}/${name}.en")"$'\n'
  fi

  # —— ⑥ 空输入的输出必须真的是空的 ——
  if [[ "$name" == "empty" ]] && [[ -s "$actual" ]]; then
    note_problem "空输入产出了 $(wc -c < "$actual" | tr -d ' ') 字节内容（应为 0）"
  fi

  # —— ⑦ 非豁免用例必须「真的变了」——
  # 转换没生效时 ② 仍可能绿（只要 expected 恰好等于 in）。这里把那种情况挡住：
  # 「这条用例什么也没测」与「测试通过」长得一样，而前者更危险。
  if [[ "$NOOP_CASES" != *" ${name} "* ]] && cmp -s "$in_file" "$actual"; then
    note_problem "输出与输入完全相同，这条用例没有验证任何转换"
  fi

  if [[ -z "$case_problems" ]]; then
    printf '  %s✓ 通过%s\n' "$C_GREEN" "$C_RESET"
    PASSED=$((PASSED + 1))
  else
    printf '  %s✗ 失败%s\n' "$C_RED" "$C_RESET"
    printf '%s' "$case_problems"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
done

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
printf '\n%s──────────────────────────────────────────────%s\n' "$C_BOLD" "$C_RESET"
printf '通过 %s%d%s · 失败 %s%d%s\n' \
  "$C_GREEN" "$PASSED" "$C_RESET" \
  "$C_RED" "$FAILED" "$C_RESET"

if [[ "$FAILED" -gt 0 ]]; then
  printf '\n%s以下用例未通过：%s\n' "$C_RED" "$C_RESET"
  for n in "${FAILED_NAMES[@]}"; do
    printf '  • %s\n' "$n"
  done
  printf '\n夹具在 %s，改转换规则时两边一起改。\n' "$FIXTURE_DIR"
  exit 1
fi

printf '\n%s✓ 发布说明转换的全部用例通过。%s\n' "$C_GREEN" "$C_RESET"
