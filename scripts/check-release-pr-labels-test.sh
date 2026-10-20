#!/usr/bin/env bash
#
# check-release-pr-labels-test.sh —— check-release-pr-labels.sh 的自测
#
# 为什么要有它：这个校验只在**发布时**被 release.yml 调用一次。如果它坏了，
# 表现是「发布照常成功、日志里什么都没说」——与「区间内每个 PR 都带了性质标签」
# 长得一模一样。发布是低频、且已经在用户可见的动作，不能拿它当唯一验证方式。
# 把每种输入固定成夹具、把退出码与输出逐字钉住，这层校验才每次 CI 都跑得到。
#
# 夹具：scripts/tests/fixtures/release-pr-labels/<用例>.in.json / .expected.txt
#   expected 是**人工核对后写下的**，不是跑脚本生成的快照——脚本自己生成的快照
#   会让「脚本坏了」与「预期变了」长得一模一样。
#
# 覆盖的核心不是「有没有标签」，而是「**该不该**有标签」：feat / fix 缺标签
# 要报，chore / docs / build / ci 缺标签不报。后者是验收阶段真实数据暴露的
# 缺陷（21 条告警几乎全是噪音），所以单独成用例，而不是混在混合用例里。
#
# 每条用例断言四件事：
#   ① 退出码等于「expected 非空 → 1；expected 为空 → 0」
#   ② stdout 与 expected 逐字一致（无缺失时 stdout 必须**真的是空**）
#   ③ stderr 为空（校验结果只走 stdout；把告警混进 stdout 会让输出不可解析）
#   ④ 用例清单与夹具目录一一对应
#
# 另有两条对照，防止断言恒真：
#   - **变异对照**：从全带标签的夹具摘掉某条 feat 的 enhancement，断言编号出现。
#     没有它，所有「无输出」的用例都可以靠「脚本永远不输出」通过。
#   - **映射同源对照**：直接拿 `pr-nature-label.sh` 对同一批标题求值，断言
#     「它认为该有标签的集合」与「脚本报缺失的集合」一致。它挡住新脚本里
#     偷偷内联第二份前缀表——那样两处一漂移，校验就会对新增前缀静默失明。
#
# 用法：
#   ./scripts/check-release-pr-labels-test.sh      # 跑全部用例（不接受参数）

set -euo pipefail

if [[ $# -gt 0 ]]; then
  printf '%s 不接受参数（收到：%s）。用法：%s\n' "${0##*/}" "$1" "${0##*/}" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
under_test="$here/check-release-pr-labels.sh"
nature_label="$here/pr-nature-label.sh"
fixture_dir="$here/tests/fixtures/release-pr-labels"

[[ -x "$under_test" ]] || { printf '找不到可执行的 %s\n' "$under_test" >&2; exit 2; }
[[ -x "$nature_label" ]] || { printf '找不到可执行的 %s\n' "$nature_label" >&2; exit 2; }
[[ -d "$fixture_dir" ]] || { printf '找不到夹具目录 %s\n' "$fixture_dir" >&2; exit 2; }

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-release-pr-labels-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

passed=0
failed=0

ok() { printf '  ✓ %s\n' "$1"; passed=$((passed + 1)); }
bad() { printf '  ✗ %s\n' "$1" >&2; failed=$((failed + 1)); }

# 用例清单显式列出：每条都要有人写清它覆盖什么。
# 清单与夹具目录的一致性由下面的全局对照断言——漏登记一条或目录里多出一个
# 没被跑过的夹具都会红。
cases=(
  "all-labeled:全部带性质标签（含无性质标签的 chore）"
  "partial-missing:部分缺失，只列缺失者"
  "all-missing:feat / fix / hotfix 全部缺失，全部列出"
  "empty:空区间（[]），无输出"
  "multiple-nature-labels:同一 PR 多个性质标签只算一次"
  "non-nature-prefixes:chore / docs / build / ci / refactor 缺标签不是缺失"
  "mixed-prefixes:feat/fix/feature/hotfix 缺 + chore/docs 缺，只列前者"
  "numeric-order:数字排序，大编号与重复 PR 都不出错"
)

printf '\n▶ 全局对照\n'

# 清单 ↔ 夹具目录必须一一对应。双向比较：清单里有、目录里没有 → 用例跑不起来；
# 目录里有、清单里没有 → 那个夹具**从来没被跑过**，看起来却像覆盖到了什么。
declared="$(printf '%s\n' "${cases[@]}" | cut -d: -f1 | sort)"
present="$(find "$fixture_dir" -name '*.in.json' -exec basename {} .in.json \; | sort)"
if [[ "$declared" == "$present" ]]; then
  ok "用例清单与夹具目录一致"
else
  bad "用例清单与夹具目录不一致（清单：$(printf '%s' "$declared" | tr '\n' ' ')；目录：$(printf '%s' "$present" | tr '\n' ' ')）"
fi

missing_expected=""
for spec in "${cases[@]}"; do
  name="${spec%%:*}"
  [[ -f "$fixture_dir/$name.expected.txt" ]] || missing_expected="${missing_expected} ${name}"
done
if [[ -z "$missing_expected" ]]; then
  ok "每个用例都有 .expected.txt"
else
  bad "以下用例缺少 .expected.txt：${missing_expected}"
fi

# 全局对照：同一批数据下，「全带标签」与「部分缺失」的输出必须不同。
# 这条挡住「脚本退化成恒不输出」——那时 all-labeled 仍绿，partial-missing 会红。
# 注意两次调用的退出码不同，不能写成 `a="$(…)" && b="$(…)"` 的链：
# partial 那条以 1 退出会让整条链走 else，看起来像输出没有区分。
rc_all=0
out_all="$("$under_test" "$fixture_dir/all-labeled.in.json" 2>/dev/null)" || rc_all=$?
rc_partial=0
out_partial="$("$under_test" "$fixture_dir/partial-missing.in.json" 2>/dev/null)" || rc_partial=$?
if [[ "$rc_all" -eq 0 ]] && [[ -z "$out_all" ]] \
  && [[ "$rc_partial" -eq 1 ]] && [[ -n "$out_partial" ]]; then
  ok "全带标签与部分缺失的输出确实不同"
else
  bad "全带标签与部分缺失的输出没有区分开（脚本可能退化成恒不输出）"
fi

printf '\n▶ 夹具用例\n'

for spec in "${cases[@]}"; do
  name="${spec%%:*}"
  desc="${spec#*:}"
  printf '\n  %s\n' "$desc"

  in_file="$fixture_dir/$name.in.json"
  expected="$fixture_dir/$name.expected.txt"
  actual="$work_dir/$name.actual.txt"
  err_file="$work_dir/$name.stderr.txt"

  # expected 非空 → 有缺失 → 1；expected 为空 → 0。
  # 期望退出码**从夹具内容派生再与输出对照**，而不是单独再写一份表：
  # 两份表会漂移，而漂移的那一份恰好是判据。
  if [[ -s "$expected" ]]; then
    want_rc=1
  else
    want_rc=0
  fi

  rc=0
  "$under_test" "$in_file" > "$actual" 2> "$err_file" || rc=$?

  problems=""
  if [[ "$rc" -ne "$want_rc" ]]; then
    problems="${problems}    退出码：期望 ${want_rc}，实得 ${rc}"$'\n'
  fi
  if ! diff -u "$expected" "$actual" > "$work_dir/$name.diff"; then
    problems="${problems}    输出不符（- 为预期，+ 为实际）："$'\n'
    problems="${problems}$(sed 's/^/      /' "$work_dir/$name.diff")"$'\n'
  fi
  if [[ -s "$err_file" ]]; then
    problems="${problems}    stderr 应为空，实得：$(tr '\n' ' ' < "$err_file")"$'\n'
  fi

  # 空输出的用例必须**真的**是 0 字节。diff 能发现非空，但这里把意图写明：
  # 「没有缺失」不等于「输出了一行空白」。
  if [[ "$want_rc" -eq 0 ]] && [[ -s "$actual" ]]; then
    problems="${problems}    无缺失时 stdout 应为空，实得 $(wc -c < "$actual" | tr -d ' ') 字节"$'\n'
  fi

  if [[ -z "$problems" ]]; then
    ok "$name"
  else
    bad "$name"
    printf '%s' "$problems"
  fi
done

printf '\n▶ 变异对照（证明脚本真的能挑出东西）\n'

# 从全带标签的夹具派生一份：把 #240（feat）的性质标签摘掉。
# 用 jq 做精确变更并断言变更生效，而不是手写第二份几乎相同的夹具——
# 手写的那份会与原件一起漂移，而这里要验的是「同一个输入只差一个标签」。
mutated="$work_dir/mutated.json"
if jq 'map(if .number == 240 then .labels = [{"name": "documentation"}] else . end)' \
    "$fixture_dir/all-labeled.in.json" > "$mutated" \
    && jq -e 'any(.[]; .number == 240 and ([.labels[].name] | index("enhancement") | not))' \
      "$mutated" >/dev/null; then
  rc=0
  got="$("$under_test" "$mutated" 2>/dev/null)" || rc=$?
  if [[ "$rc" -eq 1 ]] && [[ "$got" == "#240" ]]; then
    ok "只摘掉 feat PR #240 的 enhancement 后，恰好列出 #240"
  else
    bad "变异后应只输出 #240 且退出 1，实得退出 ${rc}、输出 [${got}]"
  fi
else
  bad "变异没有生效，这条用例什么也没测"
fi

# 反向变异：摘掉 chore PR（#243）上唯一那个**非性质**标签 documentation。
# 它仍然不该被列出——如果脚本退化成「所有缺性质标签的 PR 都报」，这条会红。
# 正反两条一起，才能同时钉住「该报的报」与「不该报的不报」。
mutated_chore="$work_dir/mutated-chore.json"
if jq 'map(if .number == 243 then .labels = [] else . end)' \
    "$fixture_dir/all-labeled.in.json" > "$mutated_chore" \
    && jq -e 'any(.[]; .number == 243 and (.labels | length) == 0)' \
      "$mutated_chore" >/dev/null; then
  rc=0
  got="$("$under_test" "$mutated_chore" 2>/dev/null)" || rc=$?
  if [[ "$rc" -eq 0 ]] && [[ -z "$got" ]]; then
    ok "chore PR #243 清空标签后仍不报缺失（无噪音）"
  else
    bad "chore PR 清空标签后不应报缺失，实得退出 ${rc}、输出 [${got}]"
  fi
else
  bad "反向变异没有生效，这条用例什么也没测"
fi

printf '\n▶ 映射同源对照（判定复用 pr-nature-label.sh，不另写前缀表）\n'

# 对混合夹具里的每个标题，直接问 `pr-nature-label.sh`「该不该有标签」，
# 再与校验脚本的输出对账。两边的输入是同一份 JSON、判定走同一个脚本，
# 所以这条断言在「新脚本内联了第二份前缀表」时才会红——那正是要防的漂移。
mixed_in="$fixture_dir/mixed-prefixes.in.json"
# expected 按**数字**排序后再加 `#`，不用 `sort -n` 去排带 `#` 的字符串：
# `#290` 与 `#1000` 在 `sort -n` 下会退化成字典序（`#1000` < `#290`），
# 而生产脚本是先排数字再加 `#`。两边必须用同一种顺序，否则这条对照会因为
# 排序差异误报（或者更糟：掩盖真正的不一致）。
expected_should="$(jq -r '.[] | [.number, .title] | @tsv' "$mixed_in" | while IFS=$'\t' read -r number title; do
  rc=0
  pair="$("$nature_label" "$title" 2> "$work_dir/nature.err")" || rc=$?
  # 映射脚本失败时不能沿用兜底：那正是问题 2 的假绿。这里直接判这条对照失败。
  if [[ "$rc" -ne 0 ]] || [[ -z "$pair" ]]; then
    bad "映射同源对照的 expected 计算失败（PR #${number}，退出 ${rc}）：$(tr '\n' ' ' < "$work_dir/nature.err")"
    continue
  fi
  if [[ -n "${pair%%:*}" ]]; then
    # 只留下**没有**性质标签的那些
    if ! jq -e --argjson n "$number" \
        'any(.[]; .number == $n and ([.labels[].name] | any(. == "enhancement" or . == "bug" or . == "security")))' \
        "$mixed_in" >/dev/null; then
      printf '%s\n' "$number"
    fi
  fi
done | sort -n | sed 's/^/#/')"
rc=0
got="$("$under_test" "$mixed_in" 2>/dev/null)" || rc=$?
got_sorted="$(printf '%s' "$got" | sort -t'#' -k2n)"
if [[ "$rc" -eq 1 ]] && [[ "$got_sorted" == "$expected_should" ]]; then
  ok "报缺失的集合与 pr-nature-label.sh 的判定一致"
else
  bad "报缺失的集合与 pr-nature-label.sh 不一致（期望 [$(printf '%s' "$expected_should" | tr '\n' ' ')]，实得 [$(printf '%s' "$got" | tr '\n' ' ')]）"
fi

printf '\n▶ 映射脚本失败（问题 2：必须报错，不能假绿）\n'

# 用桩脚本替换 `pr-nature-label.sh`：真实脚本里那种「2>/dev/null || printf ':'」
# 的兜底会把这里的故障变成「不该有标签」，然后打印「每个 PR 都带标签」。
# 桩必须放在被测脚本能找到映射脚本的位置——所以复制一份被测脚本到临时目录，
# 旁边放同名桩，而不是去动工作区里的真脚本。
stub_dir="$work_dir/stub-bin"
mkdir -p "$stub_dir"
cp "$under_test" "$stub_dir/check-release-pr-labels.sh"
chmod +x "$stub_dir/check-release-pr-labels.sh"

printf '#!/usr/bin/env bash\nprintf "映射脚本内部错误\\n" >&2\nexit 2\n' > "$stub_dir/pr-nature-label.sh"
chmod +x "$stub_dir/pr-nature-label.sh"

printf '[{"number": 300, "title": "feat(web): 本该被判定为需要标签", "labels": [{"name": "frontend"}]}]\n' \
  > "$work_dir/stub-input.json"

rc=0
out="$("$stub_dir/check-release-pr-labels.sh" "$work_dir/stub-input.json" 2> "$work_dir/stub.err")" || rc=$?
if [[ "$rc" -eq 2 ]] && [[ -z "$out" ]] && [[ -s "$work_dir/stub.err" ]]; then
  ok "映射脚本以 2 退出时，校验以 2 退出且保留 stderr"
else
  bad "映射脚本失败应让校验 exit 2 且 stderr 可见，实得 exit ${rc}、stdout [${out}]、stderr [$(tr '\n' ' ' < "$work_dir/stub.err")]"
fi
# stderr 里要有桩脚本自己写的那句话：只断言「非空」可能被无关的告警满足，
# 而失败原因恰恰是日志里最有用的部分。
if grep -qF '映射脚本内部错误' "$work_dir/stub.err"; then
  ok "映射脚本的 stderr 原样透传（没有被 2>/dev/null 吞掉）"
else
  bad "映射脚本的 stderr 被吞掉了：$(tr '\n' ' ' < "$work_dir/stub.err")"
fi

# 映射脚本 exit 0 但**什么都不输出**：正常输出至少是 `:`。空输出同样按故障处理，
# 否则「脚本被截断」会变成「不需要标签」。
printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/pr-nature-label.sh"
chmod +x "$stub_dir/pr-nature-label.sh"
rc=0
out="$("$stub_dir/check-release-pr-labels.sh" "$work_dir/stub-input.json" 2> "$work_dir/stub-empty.err")" || rc=$?
if [[ "$rc" -eq 2 ]] && [[ -z "$out" ]] && [[ -s "$work_dir/stub-empty.err" ]]; then
  ok "映射脚本输出为空时，校验以 2 退出"
else
  bad "映射脚本输出为空应让校验 exit 2，实得 exit ${rc}、stdout [${out}]"
fi

# 反向对照：桩脚本**正常**输出 `:` 时，同一个输入必须以 0 退出。
# 没有这条，上面两条断言可能在「无论映射脚本怎样都 exit 2」时也通过。
printf '#!/usr/bin/env bash\nprintf ":\\n"\n' > "$stub_dir/pr-nature-label.sh"
chmod +x "$stub_dir/pr-nature-label.sh"
rc=0
out="$("$stub_dir/check-release-pr-labels.sh" "$work_dir/stub-input.json" 2>/dev/null)" || rc=$?
if [[ "$rc" -eq 0 ]] && [[ -z "$out" ]]; then
  ok "映射脚本正常返回冒号时，同一个输入以 0 退出（对照）"
else
  bad "反向对照失败：期望 exit 0、无输出，实得 exit ${rc}、输出 [${out}]"
fi

printf '\n▶ 用法与输入错误（退出码 2，不伪装成「没有缺失」）\n'

expect_usage_error() {
  local name="$1"
  shift
  local rc=0 out="$work_dir/usage.out" err="$work_dir/usage.err"
  "$under_test" "$@" > "$out" 2> "$err" || rc=$?
  if [[ "$rc" -eq 2 ]] && [[ ! -s "$out" ]]; then
    ok "$name"
  else
    bad "${name}：期望 exit 2 且 stdout 为空，实得 exit ${rc}、stdout [$(cat "$out")]"
  fi
}

expect_usage_error "无参数"
expect_usage_error "多余参数" "$fixture_dir/all-labeled.in.json" "extra"
expect_usage_error "输入文件不存在" "$work_dir/nope.json"

printf '[] trailing' > "$work_dir/malformed.json"
expect_usage_error "JSON 语法错误" "$work_dir/malformed.json"

printf '{"number": 1}\n' > "$work_dir/object.json"
expect_usage_error "顶层不是数组" "$work_dir/object.json"

printf '[{"labels": []}]\n' > "$work_dir/no-number.json"
expect_usage_error "缺少 number 字段" "$work_dir/no-number.json"

printf '[{"number": 1, "labels": "bug"}]\n' > "$work_dir/bad-labels.json"
expect_usage_error "labels 不是数组" "$work_dir/bad-labels.json"

printf '[{"number": 1, "labels": []}]\n' > "$work_dir/no-title.json"
expect_usage_error "缺少 title 字段" "$work_dir/no-title.json"

printf '[{"number": 1, "title": "", "labels": [{"name": "documentation"}]}]\n' > "$work_dir/empty-title.json"
printf '[{"number": 2, "title": "   ", "labels": []}]\n' > "$work_dir/blank-title.json"
# 空标题是**合法输入**（映射脚本对空标题退 2，按「不该有标签」处理），
# 不该被误判成用法错误——但也不能靠「映射脚本失败」这条路径蒙混过关：
# 所以 stdout 空之外，stderr 也必须是空的（没有被当成故障打日志）。
for blank in empty-title blank-title; do
  rc=0
  "$under_test" "$work_dir/$blank.json" > "$work_dir/$blank.out" 2> "$work_dir/$blank.err" || rc=$?
  if [[ "$rc" -eq 0 ]] && [[ ! -s "$work_dir/$blank.out" ]] && [[ ! -s "$work_dir/$blank.err" ]]; then
    ok "${blank}：空白标题以 0 退出，stdout 与 stderr 都为空"
  else
    bad "${blank}：期望 exit 0 且 stdout/stderr 均为空，实得 exit ${rc}、stdout [$(cat "$work_dir/$blank.out")]、stderr [$(cat "$work_dir/$blank.err")]"
  fi
done

printf '\n──────────────────────────────────────────────\n'
printf '通过 %d · 失败 %d\n' "$passed" "$failed"
[[ "$failed" -eq 0 ]]
