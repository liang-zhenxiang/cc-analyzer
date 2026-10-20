#!/usr/bin/env bash
#
# check-release-pr-labels.sh —— 找出缺少「性质标签」的 PR
#
# 为什么需要它（Issue #244）：发布说明的变更清单按 **PR 标签**分类，而性质标签
# （enhancement / bug / security）只在这几个 PR 恰好跑过 labeler 时才有。
# 在按标题前缀打标签的步骤上线之前合并、或在那一步失败后没有重跑的 PR，
# 就只剩路径标签；`automation` / `documentation` 排在前面时，功能与修复会被
# 分进「持续集成与自动化」或「文档」，而且**没有任何东西会报错**。
#
# **只检查「本应有性质标签」的 PR。** `chore` / `docs` / `build` / `ci` 这类
# 前缀按约定本来就不打性质标签，落到「文档」或「其他变更」是预期结果；如果
# 对区间内每个 PR 都要求性质标签，真实数据里 25 个 PR 会报 21 个，几乎全是
# 噪音——这样的校验只会被维护者忽略，等于没做。
#
# 判定复用 `scripts/pr-nature-label.sh`，**不在这里另写一份前缀表**：
# 那会变成第二份需要维护的真相，两处一漂移，校验就会对新增前缀静默失明。
# 它返回的 `add` 非空即表示「这个标题应当带性质标签」。
#
# 这个脚本只回答一个问题：给定区间内的 PR 列表，哪些**应当**带性质标签的 PR
# 一个性质标签都没有。它**只读 JSON、不解析 Markdown**——`generate-notes` 的
# 输出是给人看的正文，拿正则去猜 PR 编号会在模板变动时静默漏报。结构化数据：
#
#   gh pr list --json number,title,labels
#
# 输出：每行一个缺失的 PR 编号（形如 `#226`），按编号升序；没有缺失时无输出。
# 结果只给工作流日志看，**不要**写进 release-notes.md——发布说明面向用户，
# 不该出现内部流程警告。
#
# 用法：
#   ./scripts/check-release-pr-labels.sh prs.json
#
# 退出码：0 没有缺失（含空区间）；1 有缺失；2 用法错误、输入不可解析，或
# 前缀映射脚本本身失败。1 与 2 分开是为了让调用方只把「真的有缺失」当成
# 校验结果——映射脚本坏掉时**绝不能**退化成「没有缺失」，那是假绿。

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nature_label_script="$script_dir/pr-nature-label.sh"

usage() {
  printf '用法：%s <prs.json>\n' "${0##*/}" >&2
  printf '例：gh pr list --state merged --json number,title,labels > prs.json && %s prs.json\n' "${0##*/}" >&2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage; exit 2 ;;
esac

[[ $# -eq 1 ]] || { usage; exit 2; }

input="$1"

# jq 是唯一的解析工具（CI 与本地都有）。缺失时按用法错误处理，而不是把
# 「没解析」伪装成「没有缺失」——后者会让这项校验永远绿。
if ! command -v jq >/dev/null 2>&1; then
  printf '%s：找不到 jq，无法解析 PR 列表\n' "${0##*/}" >&2
  exit 2
fi

# 映射脚本是判定「应不应当」的唯一来源，缺了它就只能靠猜（或退化成要求所有
# PR 都带标签，那正是被验收打回的噪音）。按用法错误处理，不静默放行。
if [[ ! -x "$nature_label_script" ]]; then
  printf '%s：找不到可执行的 %s（性质前缀映射的唯一来源）\n' "${0##*/}" "$nature_label_script" >&2
  exit 2
fi

if [[ ! -f "$input" ]]; then
  printf '%s：输入文件不存在：%s\n' "${0##*/}" "$input" >&2
  exit 2
fi

# 只接受 `gh pr list --json number,title,labels` 的真实形态。对象、字符串、
# 语法错误都说明调用方传错了文件，必须与「空区间」区分开——空区间是合法结果。
# `number` 必须是数字、`title` 必须是字符串：否则下面会输出 `#null`，
# 或者拿空标题去判前缀，看起来都像一条真实告警。
if ! jq -e '
  type == "array"
  and all(.[];
    (.number | type) == "number"
    and (.title | type) == "string"
    and ((.labels // []) | type) == "array"
    and all((.labels // [])[]; (.name | type) == "string")
  )
' "$input" >/dev/null 2>&1; then
  printf '%s：输入不是合法的 PR 列表（需为 gh pr list --json number,title,labels 的输出）：%s\n' \
    "${0##*/}" "$input" >&2
  exit 2
fi

# 已经带性质标签的 PR 直接跳过；剩下的才去问标题前缀。
# 先过滤再逐条调映射脚本，而不是反过来：绝大多数 PR 已有标签，省掉无谓调用。
# 一个 PR 只要命中任意一个性质标签就算合格，多个性质标签不会重复输出。
if ! without_nature="$(jq -r '
  .[]
  | select(
      ((.labels // []) | map(.name)
        | any(. == "enhancement" or . == "bug" or . == "security")) | not
    )
  | [.number, .title] | @tsv
' "$input")"; then
  printf '%s：解析 PR 列表失败：%s\n' "${0##*/}" "$input" >&2
  exit 2
fi

if [[ -z "$without_nature" ]]; then
  exit 0
fi

# 用 Tab 分隔 number 与 title：标题里可能有空格与中文，不能用空格切。
# 标题里出现 Tab 的概率可以忽略，且 jq 的 @tsv 会转义它。
missing_numbers=""
while IFS=$'\t' read -r number title; do
  [[ -n "$number" ]] || continue

  # 空白标题是 `pr-nature-label.sh` **合法**的用法错误（它明确以 2 退出）。
  # 这不是故障，按「不该有标签」处理即可——但必须先挡住，否则它会被下面
  # 那条「非零即故障」的判定当成映射脚本坏了。
  # 判据与 pr-nature-label.sh 一致：只由空白组成的标题也算空。
  if ! printf '%s' "$title" | grep -q '[^[:space:]]'; then
    continue
  fi

  # 与 labeler 走**同一个**判定：`add` 非空才说明这个标题应当带性质标签。
  #
  # 这里的失败处理是整个脚本最容易变假绿的地方。曾经的写法是
  # `pair="$(… || printf ':')"`，它把「映射脚本退出 2」「它依赖的命令不在」
  # 「被信号杀死」一律变成『不该有标签』，于是工作流打印「每个 PR 都带标签」——
  # 比不检查更危险。所以：
  #   - **不吞 stderr**（去掉 2>/dev/null），故障原因原样进日志；
  #   - 非零退出 → 整个校验以 2 退出，调用方走既有的 `*)` 告警分支；
  #   - 退出 0 但输出为空也不行：正常输出至少是 `:`，空说明脚本被截断了。
  rc=0
  pair="$("$nature_label_script" "$title")" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    printf '%s：判定 PR #%s 的标题前缀失败（%s 退出 %s）\n' \
      "${0##*/}" "$number" "${nature_label_script##*/}" "$rc" >&2
    exit 2
  fi
  if [[ -z "$pair" ]]; then
    printf '%s：判定 PR #%s 的标题前缀时输出为空（%s 应至少输出一个冒号）\n' \
      "${0##*/}" "$number" "${nature_label_script##*/}" >&2
    exit 2
  fi

  [[ -n "${pair%%:*}" ]] || continue
  missing_numbers="${missing_numbers}${number}"$'\n'
done <<< "$without_nature"

if [[ -z "$missing_numbers" ]]; then
  exit 0
fi

# 排序 + 去重让输出稳定可解析：调用方与夹具都不依赖 gh 返回的顺序。
# 用 sort/uniq 而不是 jq 的 `sort_by(.number)`，是为了让「哪些 PR 缺失」
# 与输出顺序这两件事互不纠缠，也避免数字/字符串混用时的比较差异。
# 用 `printf '%s'` 而不是 '%s\n'：`missing_numbers` 每条已自带换行，
# 再多补一个会在末尾造出空行，被 sed 变成一个孤零零的 `#`。
printf '%s' "$missing_numbers" | sort -n | uniq | sed 's/^/#/'

exit 1
