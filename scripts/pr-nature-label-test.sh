#!/usr/bin/env bash
#
# pr-nature-label-test.sh —— pr-nature-label.sh 的自测
#
# 为什么要有它：这段映射原先内联在 labeler workflow 的 `run:` 里，唯一的验证
# 方式是「提一个 PR，看标签对不对」——而发布说明的分类错了要等下一次发版才看得见，
# 且那时已经对用户可见。把映射抽成脚本、把每种前缀钉成用例，这层校验才每次 CI
# 都跑得到（Round Z 的教训：内联在 run: 里的逻辑不可测）。
#
# 用法：
#   ./scripts/pr-nature-label-test.sh      # 跑全部用例（不接受参数）

set -euo pipefail

if [[ $# -gt 0 ]]; then
  printf '%s 不接受参数（收到：%s）。用法：%s\n' "${0##*/}" "$1" "${0##*/}" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
under_test="$here/pr-nature-label.sh"

[[ -x "$under_test" ]] || { printf '找不到可执行的 %s\n' "$under_test" >&2; exit 2; }

passed=0
failed=0

ok() { printf '  ✓ %s\n' "$1"; passed=$((passed + 1)); }
bad() { printf '  ✗ %s\n' "$1" >&2; failed=$((failed + 1)); }

# 一条用例：给定标题，断言输出与退出码。
expect_output() {
  local name="$1" title="$2" want="$3"
  local got
  if got="$("$under_test" "$title" 2>/dev/null)"; then
    if [[ "$got" == "$want" ]]; then
      ok "${name}"
    else
      bad "${name}：期望 [${want}]，实得 [${got}]"
    fi
  else
    bad "${name}：非零退出"
  fi
}

expect_usage_error() {
  local name="$1"
  shift
  local code
  set +e
  "$under_test" "$@" >/dev/null 2>&1
  code=$?
  set -e
  if [[ "$code" -eq 2 ]]; then
    ok "${name}"
  else
    bad "${name}：期望 exit 2，实得 ${code}"
  fi
}

printf '\n▶ 功能（feat / feature）\n'
expect_output "feat(web): 带 scope"        "feat(web): 支持导出"        "enhancement:bug"
expect_output "feat: 不带 scope"           "feat: 支持导出"             "enhancement:bug"
expect_output "feature(api): 旧写法"       "feature(api): 支持导出"     "enhancement:bug"
expect_output "中文标题"                   "feat(web): 监控台——今天谁在烧" "enhancement:bug"

printf '\n▶ 修复（fix / hotfix）\n'
expect_output "fix(ci): 带 scope"          "fix(ci): 修发布说明分类"     "bug:enhancement"
expect_output "fix: 不带 scope"            "fix: 修一个空指针"          "bug:enhancement"
expect_output "hotfix(tauri): 旧写法"      "hotfix(tauri): 修窗口尺寸"  "bug:enhancement"

printf '\n▶ 非 feat/fix：什么都不加\n'
expect_output "docs"                       "docs: 补说明"               ":"
expect_output "chore"                      "chore(release): 发布 v1.2.3" ":"
expect_output "build"                      "build(deps): bump 依赖"      ":"
expect_output "refactor"                   "refactor(web): 抽公共函数"   ":"
expect_output "test"                       "test(web): 加用例"           ":"
expect_output "空输出只有一个冒号"          "docs: 补说明"               ":"

printf '\n▶ 不猜：非法前缀不匹配\n'
# Conventional Commits 要求类型小写。`Feat:` 不是合法类型，猜成 feat 会把一条
# 不符合规范的标题悄悄当成功能。
expect_output "大写 Feat 不匹配"            "Feat(web): 支持导出"         ":"
expect_output "大写 Fix 不匹配"             "Fix: 修一个空指针"           ":"
expect_output "fix 在中间不算前缀"          "chore: fix typo"             ":"
expect_output "英文单词含 fix 但不是前缀"    "fixup! feat: 某条"           ":"

printf '\n▶ 用法错误\n'
expect_usage_error "无参数"
expect_usage_error "空标题" ""
expect_usage_error "只有空白" "   "
expect_usage_error "多余参数" "feat: x" "extra"

printf '\n▶ 全局对照\n'
# 如果脚本退化成「永远输出 :」，上面 feat/fix 的用例会红；反过来，如果它退化成
# 「永远输出 enhancement:bug」，非 feat/fix 的用例会红。这里再断言一次两类输出
# **确实不同**，防止某天有人把脚本改成恒返一个值而没人发现。
a="$("$under_test" "feat: x")"
b="$("$under_test" "docs: y")"
if [[ "$a" != "$b" ]]; then
  ok "feat 与 docs 的输出确实不同"
else
  bad "feat 与 docs 输出相同（脚本退化成恒返一个值）"
fi

printf '\n──────────────────────────────────────────────\n'
printf '通过 %d · 失败 %d\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
