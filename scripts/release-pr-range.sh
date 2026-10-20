#!/usr/bin/env bash
#
# release-pr-range.sh —— 从上一版 tag 与当前 tag 算出 PR 查询区间
#
# 为什么需要它（Issue #244）：发布时要查「上一版之后、这一版之前」合并的 PR。
# 这段区间有两个容易写错、且**错了不会报错**的地方：
#
#   1. `git log --format=%cs` 用的是**提交自身时区**，而 GitHub 的
#      `merged:>=YYYY-MM-DD` 按 UTC 解释。一个 +08 时区深夜提交的 tag
#      （`2026-10-02T02:19:26+08:00`）用 %cs 会得到 10-02，而下界应当按 UTC
#      是 10-01——晚了一天就会漏掉那天合并的 PR。
#   2. 只有下界没有上界：当前 tag 指向的发布提交本身、以及三平台构建期间
#      合并的 PR，都会被算进这一版。它们属于下一次发布。
#
# 这些逻辑如果留在 release.yml 的 `run:` 里，唯一的验证方式就是「发一次版
# 看告警对不对」；抽成脚本后，`+08 深夜 tag` 这种时区边界可以钉进自测。
#
# 输出（三行，供调用方逐行解析，不要求 eval）：
#
#   SEARCH_SINCE=2026-10-01       # UTC 日期，喂给 gh 的 merged:>= 查询
#   PREV_EPOCH=1790907566         # 上一版 tag 的提交时刻（秒）
#   TAG_EPOCH=1792492826          # 当前 tag 的提交时刻（秒）
#
# 用法：
#   ./scripts/release-pr-range.sh <上一版 tag> <当前 tag>
#
# 退出码：0 正常；2 用法错误或 tag 无法解析。调用方在 2 时应降级为警告——
# 这一步的职责是提醒分类可能不准，不该拦住发布。

set -euo pipefail

usage() {
  printf '用法：%s <上一版 tag> <当前 tag>\n' "${0##*/}" >&2
  printf '例：%s v0.27.0 v0.28.0\n' "${0##*/}" >&2
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  "") usage; exit 2 ;;
esac

[[ $# -eq 2 ]] || { usage; exit 2; }

prev_tag="$1"
current_tag="$2"

for tag in "$prev_tag" "$current_tag"; do
  if [[ -z "$tag" ]]; then
    usage
    exit 2
  fi
  # `^{commit}` 把附注 tag 解到它指向的提交；失败时 git 已经给出原因，
  # 这里补一句上下文即可——把 stderr 吞掉会让「tag 拼错」看起来像别的故障。
  if ! git rev-parse --verify --quiet "${tag}^{commit}" >/dev/null; then
    printf '%s：无法解析 tag：%s\n' "${0##*/}" "$tag" >&2
    exit 2
  fi
done

# 日期必须按 UTC 取：`format-local` 配合 TZ=UTC 是 git 里唯一能同时做到
# 「按提交时刻」与「指定时区」的组合（`--date=short` / %cs 只认提交时区）。
search_since="$(TZ=UTC git log -1 --date=format-local:%Y-%m-%d --format=%cd "$prev_tag")"
prev_epoch="$(git log -1 --format=%ct "$prev_tag")"
tag_epoch="$(git log -1 --format=%ct "$current_tag")"

# 从 git 拿到的值正常情况下一定合法；仍然校验一次，避免把空值或异常文本
# 传给 jq 的 --argjson（那会在构建日志里变成一行难懂的 jq 报错）。
if ! printf '%s' "$search_since" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
    || ! printf '%s' "$prev_epoch" | grep -Eq '^[0-9]+$' \
    || ! printf '%s' "$tag_epoch" | grep -Eq '^[0-9]+$'; then
  printf '%s：无法从 tag 取得合法的提交时间（%s / %s / %s）\n' \
    "${0##*/}" "$search_since" "$prev_epoch" "$tag_epoch" >&2
  exit 2
fi

# 区间必须是正向的。反了说明调用方把两个 tag 传颠倒，或者 tag 指向了
# 历史提交——这不是「没有 PR」，不能伪装成空区间。
if [[ "$prev_epoch" -ge "$tag_epoch" ]]; then
  printf '%s：上一版 tag（%s）不早于当前 tag（%s），区间无效\n' \
    "${0##*/}" "$prev_tag" "$current_tag" >&2
  exit 2
fi

printf 'SEARCH_SINCE=%s\n' "$search_since"
printf 'PREV_EPOCH=%s\n' "$prev_epoch"
printf 'TAG_EPOCH=%s\n' "$tag_epoch"
