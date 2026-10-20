#!/usr/bin/env bash
#
# release-pr-range-test.sh —— release-pr-range.sh 的自测
#
# 为什么要有它：区间下界曾经用 `%cs`（提交自身时区），而 GitHub 的
# `merged:>=YYYY-MM-DD` 按 UTC 解释。一个 +08 深夜发布的 tag 会让下界晚一天，
# 静默漏掉那天合并的 PR——告警不会响，因为漏报本来就是「看起来都正常」。
# 这段逻辑如果留在 release.yml 的 `run:` 里就没法测；抽成脚本后，这里用真实
# 的 git 仓库造出那个时区边界，把结果逐字钉住。
#
# 除时区外还覆盖：上界（当前 tag 的 epoch）、颠倒的 tag、无法解析的 tag、
# 用法错误。区间反了必须报错而不是退化成「空区间」——那会静默跳过校验。
#
# 用法：
#   ./scripts/release-pr-range-test.sh      # 跑全部用例（不接受参数）

set -euo pipefail

if [[ $# -gt 0 ]]; then
  printf '%s 不接受参数（收到：%s）。用法：%s\n' "${0##*/}" "$1" "${0##*/}" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
under_test="$here/release-pr-range.sh"

[[ -x "$under_test" ]] || { printf '找不到可执行的 %s\n' "$under_test" >&2; exit 2; }

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/release-pr-range-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

passed=0
failed=0

ok() { printf '  ✓ %s\n' "$1"; passed=$((passed + 1)); }
bad() { printf '  ✗ %s\n' "$1" >&2; failed=$((failed + 1)); }

# 在一个空仓库里按指定时刻造提交并打两个 tag。
# 用真实的 git 仓库而不是桩：这里要验的正是 git 对时区与附注 tag 的实际
# 行为，桩只会把「我们对 git 的想象」再复述一遍。
make_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email test@example.com
  git -C "$dir" config user.name test
}

commit_at() {
  local dir="$1" date="$2" msg="$3"
  GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" \
    git -C "$dir" commit -q --allow-empty -m "$msg"
}

# 断言三行输出逐字一致。
expect_range() {
  local name="$1" dir="$2" prev="$3" cur="$4"
  local want_since="$5" want_prev_epoch="$6" want_tag_epoch="$7"
  local got rc=0
  got="$(cd "$dir" && "$under_test" "$prev" "$cur" 2>/dev/null)" || rc=$?
  local want="SEARCH_SINCE=${want_since}"$'\n'"PREV_EPOCH=${want_prev_epoch}"$'\n'"TAG_EPOCH=${want_tag_epoch}"
  if [[ "$rc" -eq 0 ]] && [[ "$got" == "$want" ]]; then
    ok "$name"
  else
    bad "${name}：期望 exit 0 且输出 [${want}]，实得 exit ${rc}、输出 [${got}]"
  fi
}

expect_usage_error() {
  local name="$1" dir="$2"
  shift 2
  local rc=0 err="$work_dir/err.txt"
  (cd "$dir" && "$under_test" "$@") >/dev/null 2> "$err" || rc=$?
  if [[ "$rc" -eq 2 ]]; then
    if [[ -s "$err" ]]; then
      ok "$name"
    else
      bad "${name}：exit 2 但 stderr 为空，调用方看不到原因"
    fi
  else
    bad "${name}：期望 exit 2，实得 ${rc}"
  fi
}

printf '\n▶ 时区边界（问题 1 的回归）\n'

repo="$work_dir/tz"
make_repo "$repo"
# 1 月 1 日先在 UTC 建一个基线提交
commit_at "$repo" "2026-01-01T00:00:00+00:00" "base"

# **下界取自上一版 tag**，所以时区边界必须落在 v0.4.0 这个提交上：
# +08 的深夜（UTC 仍是 10-01，提交自身时区显示 10-02），正是问题 1 的形态。
# `%cs` 会给出 10-02（下界晚一天、漏报），UTC 口径必须给出 10-01。
commit_at "$repo" "2026-10-02T02:19:26+08:00" "release previous"
git -C "$repo" tag v0.4.0

# 再往后一天发布当前版本
commit_at "$repo" "2026-10-03T12:00:00+00:00" "release current"
git -C "$repo" tag v0.5.0

prev_epoch="$(git -C "$repo" log -1 --format=%ct v0.4.0)"
tag_epoch="$(git -C "$repo" log -1 --format=%ct v0.5.0)"

# 对照：证明这个夹具确实落在会出错的时区里——否则下面的断言可能恒真。
committer_date="$(git -C "$repo" log -1 --format=%cs v0.4.0)"
if [[ "$committer_date" == "2026-10-02" ]]; then
  ok "夹具确实落在 %cs 会晚一天的时区边界上（%cs = 2026-10-02）"
else
  bad "夹具没有复现问题 1 的前提（%cs = ${committer_date}，期望 2026-10-02）"
fi

expect_range "+08 深夜 tag 的下界按 UTC 取（10-01 而非 10-02）" \
  "$repo" v0.4.0 v0.5.0 "2026-10-01" "$prev_epoch" "$tag_epoch"

printf '\n▶ 上界（问题 3 的回归）\n'

# 当前 tag 之后还有合并提交：它的时刻必须大于 TAG_EPOCH。调用方用
# `mergedAt <= TAG_EPOCH` 过滤，才不会把构建期间合并的 PR 算进这一版。
commit_at "$repo" "2026-10-03T20:00:00+00:00" "merged after tag"
after_epoch="$(git -C "$repo" log -1 --format=%ct HEAD)"
if [[ "$after_epoch" -gt "$tag_epoch" ]]; then
  ok "tag 之后的提交时刻确实大于 TAG_EPOCH（上界有判别力）"
else
  bad "上界没有判别力：tag 之后的提交 epoch ${after_epoch} 不大于 ${tag_epoch}"
fi

printf '\n▶ 颠倒 / 无法解析的 tag（必须报错，不能退化成空区间）\n'

expect_usage_error "上一版比当前 tag 新" "$repo" v0.5.0 v0.4.0
expect_usage_error "同一个 tag" "$repo" v0.5.0 v0.5.0
expect_usage_error "不存在的 tag" "$repo" v0.4.0 v9.9.9
expect_usage_error "参数不足" "$repo" v0.4.0
expect_usage_error "多余参数" "$repo" v0.4.0 v0.5.0 extra

# 空 tag 参数：`git rev-parse ""` 在部分版本上会退化成 HEAD，必须显式拒绝。
rc=0
(cd "$repo" && "$under_test" "" v0.5.0) >/dev/null 2>&1 || rc=$?
if [[ "$rc" -eq 2 ]]; then
  ok "空的上一版 tag 被拒绝"
else
  bad "空的上一版 tag 应以 2 退出，实得 ${rc}"
fi

printf '\n──────────────────────────────────────────────\n'
printf '通过 %d · 失败 %d\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
