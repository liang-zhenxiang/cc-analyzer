#!/usr/bin/env bash
#
# promote-changelog.sh —— 把先行版登记「晋升」为稳定版登记
#
# 背景：CHANGELOG 里两种版本的**登记形态不同**，而这个差异会让晋升丢内容。
#
#   形态 A（现行规则）：先行版发布时就把 `[Unreleased]` 归档成
#     `## [X.Y.Z-beta.N] - <日期>` 段。晋升时只要把这一段改名为稳定版段即可。
#
#   形态 B（早期形态）：先行版**不**归档，条目一直积压在 `[Unreleased]` 里，
#     晋升时才第一次开段。v0.11.0 及更早是这个形态。
#
# 为什么需要这个脚本：promote-stable 工作流原先**只做形态 B**——在
# `[Unreleased]` 后面插一个新版本标题。规则改成「先行版就归档」之后，
# `[Unreleased]` 成了空壳，插入的标题下面**空无一物**：真正的条目留在
# `## [X.Y.Z-beta.N]` 段里。而 `extract-changelog-section.sh` 的路径 ① 优先取
# `## [X.Y.Z]` 段——于是稳定版的发布说明只剩「本轮主题」一句加一个空的
# `### Added` 标题，**条目全丢**，而且退出码是 0（静默）。
#
# 这个冲突从规则改掉的那天起就存在，只是直到第一次「按新规则发布先行版 → 晋升」
# 才够得到。所以逻辑从工作流的 `run:` 里抽到这里：内联在 `run:` 里的东西唯一的
# 验证方式就是「发一次版，用人眼看」，而发布是低频且已经对用户可见的动作。
#
# 用法：
#   ./scripts/promote-changelog.sh <稳定版> <先行版> <日期> [主题] [CHANGELOG 路径]
#     稳定版  0.27.0（可带前导 v）
#     先行版  0.27.0-beta.1（可带前导 v）
#     日期    2026-10-17（写进段标题；不传则用今天，跨平台脚本里别做 epoch 往返）
#     主题    可选。形态 B 下写进段首「本轮主题：…」；形态 A 下用不到
#             （段内已经有说明性文字，只做措辞收敛）
#     路径    默认 CHANGELOG.md
#
# 就地把结果写回文件（发布工作流直接在 checkout 出来的工作区里提交）。
#
# 退出码：0 成功；2 用法错误；3 结构性错误（没有可归档的内容——**不能静默通过**，
#         否则又会产出内容为空的稳定版发布说明）。

set -euo pipefail

usage() {
  printf '用法：%s <稳定版> <先行版> <日期> [主题] [CHANGELOG 路径]\n' "${0##*/}" >&2
  printf '例：%s 0.27.0 0.27.0-beta.1 2026-10-17 "里程碑" CHANGELOG.md\n' "${0##*/}" >&2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage; exit 2 ;;
esac

[[ $# -ge 3 ]] || { usage; exit 2; }

stable="${1#v}"
beta="${2#v}"
today="$3"
theme="${4:-}"
changelog="${5:-CHANGELOG.md}"

[[ -n "$stable" && -n "$beta" && -n "$today" ]] || { usage; exit 2; }
[[ -f "$changelog" ]] || { printf '%s：找不到 %s\n' "${0##*/}" "$changelog" >&2; exit 2; }

# 把三个参数交给 python：用它做多行替换，bash 里没有既能读多字节又可靠的写法
# （`${var//…}` 在 bash 3.2 上对多字节是二次复杂度，见 #210）。
python3 - "$stable" "$beta" "$today" "$theme" "$changelog" <<'PY'
import re
import sys

stable, beta, today, theme, path = sys.argv[1:6]
text = open(path, encoding="utf-8").read()

stable_heading = f"## [{stable}] - {today}"
beta_heading = f"## [{beta}] - "


def heading_line_index(lines, prefix, exact=False):
    """第一条以 prefix 开头的标题行下标；exact 时要求整行相等。"""
    for i, line in enumerate(lines):
        if line == prefix if exact else line.startswith(prefix):
            return i
    return -1


lines = text.splitlines()

# ---------------------------------------------------------------------------
# 幂等：这个版本已经登记过就不动。tag 重推会触发第二次发布工作流，
# 那一次不该把已经晋升好的段落再处理一遍。
# ---------------------------------------------------------------------------
if heading_line_index(lines, stable_heading, exact=True) >= 0:
    print(f"{stable} 已经登记过，CHANGELOG 不变")
    sys.exit(0)

# ---------------------------------------------------------------------------
# 形态 A：先行版已经开过段
# ---------------------------------------------------------------------------
beta_index = heading_line_index(lines, beta_heading)
if beta_index >= 0:
    lines[beta_index] = stable_heading

    # 措辞收敛：这一段讲的是稳定版，不该再说「先行版」。
    #   「本轮的先行版是 **v0.27.0-beta.1（里程碑）**——…」
    #   →「本轮主题：**里程碑**——…」
    # 只动这一句的引导词与版本号，破折号后面的说明原样保留——那是对使用者的归纳。
    # 括号里的主题名要**留下**：直接换成「本轮主题：**」会得到「**（里程碑）**」
    # （加粗包住一对多余的括号）。
    old_prefix = f"本轮的先行版是 **v{beta}"
    with_theme = re.compile(r"本轮的先行版是 \*\*v" + re.escape(beta) + r"（(.+?)）\*\*")
    for i in range(beta_index + 1, len(lines)):
        if lines[i].startswith("## ["):
            break
        if old_prefix not in lines[i]:
            continue
        promoted, count = with_theme.subn(r"本轮主题：**\1**", lines[i], count=1)
        # 主题名没写成括号时退回最小替换：至少把「先行版 vX.Y.Z-beta.N」去掉。
        lines[i] = promoted if count else lines[i].replace(old_prefix, "本轮主题：**", 1)
        break

    # 条目前缀「- **先行版 v0.27.0-beta.1（本轮主题）**：…」→「- **v0.27.0（本轮主题）**：…」
    old_bullet = f"- **先行版 v{beta}（本轮主题）**"
    new_bullet = f"- **v{stable}（本轮主题）**"
    for i in range(beta_index + 1, len(lines)):
        if lines[i].startswith("## ["):
            break
        if lines[i].startswith(old_bullet):
            lines[i] = new_bullet + lines[i][len(old_bullet):]
            break

    note = f"形态 A：把先行版段 {beta} 晋升为 {stable}"

# ---------------------------------------------------------------------------
# 形态 B：条目还积压在 [Unreleased]
# ---------------------------------------------------------------------------
else:
    unreleased_index = heading_line_index(lines, "## [Unreleased]", exact=True)
    if unreleased_index < 0:
        print("CHANGELOG 里既没有先行版段，也没有 [Unreleased] 段", file=sys.stderr)
        sys.exit(3)

    body = lines[unreleased_index + 1 :]
    # 下一条版本标题之前的全部内容，就是待归档的条目。
    next_heading = next((i for i, l in enumerate(body) if l.startswith("## [")), len(body))
    pending = body[:next_heading]

    # 判据是**有没有条目**（`- ` 顶格），不是「有没有非空行」：现行规则下
    # `[Unreleased]` 归档后会留一个空壳——`### Added` 标题还在，条目没了。
    # 按非空行判会把那个空壳当成「有内容」，于是产出只有标题、没有条目的
    # 稳定版发布说明（也就是本脚本要拦的那一次）。
    has_entries = any(line.startswith("- ") for line in pending)
    if not has_entries:
        print(
            f"CHANGELOG 的 [Unreleased] 是空的，也没有 {beta} 段——没有可归档的内容。",
            file=sys.stderr,
        )
        print(
            "这会让稳定版发布说明丢掉全部条目（只剩一个空标题）。"
            "先确认先行版有没有按现行规则归档成 `## [<版本>]` 段。",
            file=sys.stderr,
        )
        sys.exit(3)

    insert = ["", stable_heading, ""]
    if theme:
        insert += [f"本轮主题：{theme}", ""]
    # 原来 `[Unreleased]` 下面的前导空行要吃掉，否则新段标题与主题句之间会多一行。
    rest = lines[unreleased_index + 1 :]
    while rest and not rest[0].strip():
        rest = rest[1:]
    lines = lines[: unreleased_index + 1] + insert + rest

    note = f"形态 B：把 [Unreleased] 里的条目归档为 {stable}"

open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"{note}（{path}）")
PY
