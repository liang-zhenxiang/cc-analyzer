#!/usr/bin/env bash
#
# promote-changelog-test.sh —— promote-changelog.sh 的自测
#
# 为什么要有它：这段归档逻辑原先内联在 promote-stable 工作流的 `run:` 里，唯一的
# 验证方式是「晋升一次，用人眼看发布说明对不对」——而晋升是低频、且一旦打出 tag
# 就已经对用户可见的动作（发错了只能改说明，改不回那一次构建）。
#
# 更要紧的是它**出过一次静默的错误**：规则改成「先行版发布时就归档 CHANGELOG」
# 之后，`[Unreleased]` 在晋升时是个只剩 `### Added` 标题的空壳，而旧逻辑
# 只会在它后面插一个空标题——稳定版发布说明因此丢掉全部条目，且退出码是 0。
# 这一类「不报错但内容为空」的失败，唯一的防线就是把形态固定成夹具每次跑。
#
# 夹具：scripts/tests/fixtures/promote-changelog/<用例>.in.md / <用例>.expected.md
#   expected 是**人工核对后写下的**，不是脚本生成的快照——脚本自己生成的快照会让
#   「脚本坏了」与「预期变了」长得一模一样。
#
# 覆盖三个形态与两类结构性错误：
#   ① 形态 A（现行）：先行版已归档成 `## [X.Y.Z-beta.N]` 段 → 该段晋升为稳定版段
#   ② 形态 B（早期）：条目积压在 `[Unreleased]` → 开新段并写入主题句
#   ③ 幂等：对已晋升过的文件再跑一次，逐字节不变（tag 重推会触发第二次发布工作流）
#   ④ 空壳 + 无先行版段 → **exit 3**（这一条就是那次静默错误的回归防线）
#   ⑤ 用法错误（缺参数 / 文件不存在）→ exit 2
#
# 用法：
#   ./scripts/promote-changelog-test.sh      # 跑全部用例（不接受参数）
#
# **不提供 --help**，并把任何参数当作错误拒掉（与 scripts/lint.sh 一致）。

set -euo pipefail

if [[ $# -gt 0 ]]; then
  printf '%s 不接受参数（收到：%s）。用法：%s\n' "${0##*/}" "$1" "${0##*/}" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
under_test="$here/promote-changelog.sh"
fixtures="$here/tests/fixtures/promote-changelog"

[[ -x "$under_test" ]] || { printf '找不到可执行的 %s\n' "$under_test" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

passed=0
failed=0

ok() {
  printf '  ✓ %s\n' "$1"
  passed=$((passed + 1))
}

bad() {
  printf '  ✗ %s\n' "$1" >&2
  failed=$((failed + 1))
}

# 一条用例：把 in 复制到工作区、跑被测脚本、与 expected 逐字比对。
case_text() {
  local name="$1" stable="$2" beta="$3" date="$4" theme="$5"
  local file="$work/$name.md"
  cp "$fixtures/$name.in.md" "$file"

  if ! "$under_test" "$stable" "$beta" "$date" "$theme" "$file" >"$work/$name.log" 2>&1; then
    bad "${name}：脚本非零退出（$(cat "$work/$name.log")）"
    return
  fi
  if diff -u "$fixtures/$name.expected.md" "$file" >"$work/$name.diff" 2>&1; then
    ok "${name}：输出与 expected 逐字一致"
  else
    bad "${name}：输出与 expected 不一致"
    sed 's/^/      /' "$work/$name.diff" >&2
  fi
}

printf '\n▶ 形态 A / B\n'
case_text "form-a" "0.27.0" "0.27.0-beta.1" "2026-10-17" "里程碑"
case_text "form-b" "0.11.0" "0.11.0-beta.1" "2026-10-04" "把分析结果带出去"

printf '\n▶ 幂等\n'
# 对已经晋升过的文件再跑一次，必须逐字节不变：tag 重推会走同一条路径。
idem="$work/form-a-idempotent.md"
cp "$fixtures/form-a.expected.md" "$idem"
if "$under_test" "0.27.0" "0.27.0-beta.1" "2026-10-17" "里程碑" "$idem" >"$work/idem.log" 2>&1 \
   && diff -q "$fixtures/form-a.expected.md" "$idem" >/dev/null; then
  ok "已晋升过的文件再跑一次逐字不变"
else
  bad "幂等失败（$(cat "$work/idem.log")）"
fi

printf '\n▶ 结构性错误\n'
# ④ 空壳 + 没有对应先行版段：这一次的静默错误。必须**非零退出**且不改文件。
empty="$work/empty.md"
cp "$fixtures/empty-unreleased.in.md" "$empty"
set +e
"$under_test" "0.27.0" "0.27.0-beta.1" "2026-10-17" "里程碑" "$empty" >"$work/empty.log" 2>&1
code=$?
set -e
if [[ "$code" -eq 3 ]]; then
  ok "空壳 + 无先行版段：exit 3（拦住静默产出空发布说明）"
else
  bad "空壳 + 无先行版段：期望 exit 3，实得 $code"
fi
if diff -q "$fixtures/empty-unreleased.in.md" "$empty" >/dev/null; then
  ok "失败时不动文件"
else
  bad "失败时改动了文件"
fi

# 错误信息要能指路（这一条是给半年后的自己看的）。
if grep -q '\[Unreleased\]' "$work/empty.log"; then
  ok "错误信息点出了 [Unreleased] 与先行版段两条路径"
else
  bad "错误信息没说清是哪两条路径"
fi

printf '\n▶ 用法错误\n'
set +e
"$under_test" >/dev/null 2>&1
code=$?
set -e
# 写成 `[[ … ]] && ok … || bad …` 的话，`ok` 自身失败时 `bad` 也会跑
# （`A && B || C` 不是 if-then-else，shellcheck SC2015）。
if [[ "$code" -eq 2 ]]; then
  ok "无参数：exit 2"
else
  bad "无参数：期望 exit 2，实得 $code"
fi

set +e
"$under_test" "0.27.0" "0.27.0-beta.1" "2026-10-17" "" "$work/does-not-exist.md" >/dev/null 2>&1
code=$?
set -e
if [[ "$code" -eq 2 ]]; then
  ok "文件不存在：exit 2"
else
  bad "文件不存在：期望 exit 2，实得 $code"
fi

# 全局对照：夹具本身必须「真的会变」——如果 in 与 expected 逐字相同，
# 上面那几条「与 expected 一致」就什么也没测。
for name in form-a form-b; do
  if diff -q "$fixtures/$name.in.md" "$fixtures/$name.expected.md" >/dev/null; then
    bad "$name 的 in 与 expected 相同——这条用例什么都没测"
  fi
done
ok "夹具自检：两条用例的 in 与 expected 确实不同"

printf '\n──────────────────────────────────────────────\n'
printf '通过 %d · 失败 %d\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
