#!/usr/bin/env bash
#
# extract-changelog-section.sh —— 取出 CHANGELOG 里「本版本」的手写说明
#
# 发布说明的第一段是维护者手写的归纳，来源是 CHANGELOG.md。但本仓库的两种版本
# **登记形态不同**，所以这里有两条件：
#
#   ① 稳定版：CHANGELOG 里有一个 `## [<version>]` 段 → 取段内正文。
#   ② 先行版（`vX.Y.Z-beta.N`）：按约定**不新开段**，只在 `## [Unreleased]`
#      顶部写一条 `- **先行版 v<version>（本轮主题）**：…`（含缩进的子条目）
#      → 取那一条。
#
# 只有 ① 的时候，每一个先行版的发布说明都会掉进「本版本未在 CHANGELOG.md 中
# 单独登记」的降级分支——而维护者其实登记了，只是形态不同。把「没找到版本标题」
# 误报成「维护者没写」，会让人去补一份本来就有的说明（见 #127）。
#
# ② 的查找**不限段**：`[Unreleased]` 里的条目在稳定版晋升时会被归档进
# `## [<version>]`，那时同一个先行版条目仍然要能被找到。
#
# 用法：
#   ./scripts/extract-changelog-section.sh <版本> [CHANGELOG 路径]
#     <版本>   可带或不带前导 `v`（`release.yml` 传的是去掉 v 的那一半）
#     [路径]   默认 `CHANGELOG.md`（相对当前目录）
#
# 输出：段落正文原样打到 stdout（空 = 没找到）。
# 退出码：0 找到；3 没找到（**不是**错误——发布工作流据此走降级分支）；
#         2 用法错误。

set -euo pipefail

usage() {
  printf '用法：%s <版本> [CHANGELOG 路径]\n' "${0##*/}" >&2
  printf '例：%s 0.13.0-beta.1 CHANGELOG.md\n' "${0##*/}" >&2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage; exit 2 ;;
esac

# 前导 `v` 去掉：`release.yml` 传 `${TAG#v}`，但手动调用时常顺手写成 tag 的样子。
version="${1#v}"
changelog="${2:-CHANGELOG.md}"

if [[ ! -f "$changelog" ]]; then
  printf '%s：找不到 %s\n' "${0##*/}" "$changelog" >&2
  exit 2
fi

# 段落正文去掉首尾空行。不这么做的话，`## [x.y.z]` 后面那一行空行会跟着进发布
# 说明（旧的内联 awk 就是这个行为），而条目之间的空行也会被当成「这一条的内容」
# 留一截在末尾——两种都是排版噪声，不是内容。
trim_blank_lines() {
  awk '
    { line[NR] = $0 }
    END {
      first = 1
      while (first <= NR && line[first] ~ /^[[:space:]]*$/) first++
      last = NR
      while (last >= first && line[last] ~ /^[[:space:]]*$/) last--
      for (i = first; i <= last; i++) print line[i]
    }
  '
}

# 「这段是不是只有空白」。
#
# **不要**写成 `[[ -n "${var//[[:space:]]/}" ]]`。bash 3.2（macOS 自带的那一个）
# 在做这种「把多字节内容里所有匹配项替换掉」的展开时是**二次**的：纯 ASCII
# 59 KB 瞬间返回，而中文是**按长度平方**涨的——实测 3.8 KB 约 0.6 s、7.6 KB 约 4 s、
# 15 KB 约 17 s、30 KB 约 114 s；真实 CHANGELOG 攒到 59 KB 时是**十几分钟**，
# 看起来就是脚本挂死。
# 这个脚本以前正是那样写的，直到某个先行版把 `[Unreleased]` 攒到 58 KB 才暴露
# （见 #210）。这段代码的实际用途只是「非空即算找到了」，交给 grep 即可，
# 它对任意大小与编码都是线性的。
has_non_blank() {
  grep -q '[^[:space:]]' <<<"$1"
}

# ---------------------------------------------------------------------------
# ① 稳定版：`## [<version>]` 段
#
# 匹配用 `[ver]` 整段（含右括号），所以找 `0.11.0` 时不会命中 `[0.11.0-beta.1]`。
# ---------------------------------------------------------------------------
section="$(
  awk -v ver="$version" '
    /^## \[/ {
      if (found) exit
      if (index($0, "[" ver "]") > 0) { found = 1; next }
    }
    found { print }
  ' "$changelog"
)"

if has_non_blank "$section"; then
  printf '%s\n' "$section" | trim_blank_lines
  exit 0
fi

# ---------------------------------------------------------------------------
# ② 先行版：`- **先行版 v<version>…**` 那一条（含其缩进子条目）
#
# 收集到「下一个顶层条目 / 下一个标题」为止。`- ` 只匹配第 0 列，所以子条目
# `  - …` 不会被当成终点。
#
# 版本后面跟数字视为不匹配：找 `1.3.0-beta.1` 时不该命中 `1.3.0-beta.10`。
# ---------------------------------------------------------------------------
bullet="$(
  awk -v needle="- **先行版 v${version}" '
    BEGIN { started = 0; stop = 0 }
    stop { next }
    {
      if (!started) {
        if (index($0, needle) == 1 && substr($0, length(needle) + 1) !~ /^[0-9]/) {
          started = 1
          print
        }
        next
      }
      if ($0 ~ /^#+ / || $0 ~ /^- /) { stop = 1; next }
      print
    }
  ' "$changelog"
)"

if has_non_blank "$bullet"; then
  printf '%s\n' "$bullet" | trim_blank_lines
  exit 0
fi

exit 3
