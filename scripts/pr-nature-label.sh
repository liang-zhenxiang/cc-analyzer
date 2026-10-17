#!/usr/bin/env bash
#
# pr-nature-label.sh —— 按 PR 标题的 conventional 前缀决定「性质标签」
#
# 为什么需要它（Issue #221）：发布说明的「变更清单」按 **PR 标签**分类，
# 而 `actions/labeler` 只能按**改动路径**打标签（frontend / documentation …）。
# 性质标签（enhancement / bug）原先只靠人工打，AI 维护者建 PR 时从不打——
# 于是每个 PR 都只剩路径标签；再加上流程要求每个用户可感知的改动都写 CHANGELOG
# （`.md`），`documentation` 几乎人人都有，分类就一路落到「文档」那一格。
#
# 这个脚本把「标题前缀 → 性质标签」的映射收在一处，让它可测。
#
# 输出（一行，冒号分隔的 `add:remove`）：
#
#   enhancement:bug     feat* / feature*   → 加 enhancement，并摘掉 bug
#   bug:enhancement     fix* / hotfix*     → 加 bug，并摘掉 enhancement
#   :                   其它前缀            → 都不加、都不摘
#
# `remove` 那一半是为了标题从 feat 改成 fix（或反过来）时不留上一条性质标签——
# 否则发布说明会按上一次的标签分类。
#
# 用法：
#   ./scripts/pr-nature-label.sh "feat(web): 支持导出"
#
# 退出码：0 正常；2 用法错误（缺参数 / 空标题）。
#
# 只认**小写**前缀：Conventional Commits 要求类型小写，`Feat:` 不是合法类型，
# 猜成 feat 会把一条不符合规范的标题悄悄当成功能。

set -euo pipefail

usage() {
  printf '用法：%s <PR 标题>\n' "${0##*/}" >&2
  printf '例：%s "feat(web): 支持导出"\n' "${0##*/}" >&2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage; exit 2 ;;
esac

[[ $# -eq 1 ]] || { usage; exit 2; }

title="$1"
# 空标题（含只由空白组成的）当用法错误。
# **不要**写成 `[[ -n "${title//[[:space:]]/}" ]]`：bash 3.2 对多字节做这种
# 全量替换是二次复杂度（#210 的坑）。这里虽然标题很短，但规则不分长短。
if ! printf '%s' "$title" | grep -q '[^[:space:]]'; then
  usage
  exit 2
fi

# 前缀后面必须紧跟 `(`（带 scope）、`:`（不带 scope）或空格——不能只认
# `feat*` / `fix*`：`fixup! feat: …` 也以 fix 开头，但它不是提交类型
# （`check-commit-msg.sh` 明确放行 fixup!/squash! 作为 rebase 中间产物）。
case "$title" in
  feat\(*|feat:*|feat\ *|feature\(*|feature:*|feature\ *)
    printf 'enhancement:bug\n' ;;
  fix\(*|fix:*|fix\ *|hotfix\(*|hotfix:*|hotfix\ *)
    printf 'bug:enhancement\n' ;;
  *)
    printf ':\n' ;;
esac
