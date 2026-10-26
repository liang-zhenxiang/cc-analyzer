#!/usr/bin/env bash
#
# check-gtk-unblock-test.sh —— check-gtk-unblock.sh 的自测
#
# 全部用例走本地夹具，不碰网络：
#   - blocked / partial / unblocked 三种判定与机器标记必须同时正确
#   - 三种结论各自的下一步提示必须出现
#   - --dry-run 必须不调用 gh（用一个会写哨兵的假 gh 验证）
#   - 网络路径的 JSON 解析与记录拼装（用一个返回固定响应的假 curl 验证）
#   - --comment 的去重与发帖两条分支（用假 gh 验证）
#   - --comment 缺少 GH_TOKEN 时必须退出 1
#   - 夹具不合法时必须退出 1 并说明原因
#
# 为什么不用「只断言输出里有 blocked」：状态词会出现在无关位置（例如
# unblocked 里包含 blocked 子串）。所以这里断言**完整标记**，它同时钉住
# verdict 与三个 gtk 要求。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CHECK="${SCRIPT_DIR}/check-gtk-unblock.sh"
FIXTURES="${SCRIPT_DIR}/tests/fixtures/gtk-unblock"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-gtk-unblock-test.sh: 需要 python3\n' >&2
  exit 2
fi

for name in blocked partial unblocked; do
  if [[ ! -f "${FIXTURES}/${name}.json" ]]; then
    printf 'check-gtk-unblock-test.sh: 缺少夹具 %s\n' "${FIXTURES}/${name}.json" >&2
    exit 2
  fi
done

PASSED=0
FAILED=0

pass() {
  printf '  ✓ %s\n' "$1"
  PASSED=$((PASSED + 1))
}

fail() {
  printf '  ✗ %s\n' "$1"
  FAILED=$((FAILED + 1))
}

# 运行检查脚本，把输出与退出码放到全局 OUT / RC。
run_check() {
  set +e
  OUT="$("${CHECK}" "$@" 2>&1)"
  RC=$?
  set -e
}

# $1 夹具名，$2 结论短语，$3 完整标记，$4 必须出现的下一步提示。
expect_fixture() {
  local name="$1"
  local verdict="$2"
  local marker="$3"
  local needle="$4"

  run_check --fixture "${FIXTURES}/${name}.json"

  if [[ "$RC" -ne 0 ]]; then
    fail "${name}：退出码 ${RC}（应为 0）"
    printf '%s\n' "$OUT"
    return
  fi
  if [[ "$OUT" != *"$verdict"* ]]; then
    fail "${name}：输出未包含「${verdict}」"
    printf '%s\n' "$OUT"
    return
  fi
  if [[ "$OUT" != *"$marker"* ]]; then
    fail "${name}：输出未包含完整标记「${marker}」"
    printf '%s\n' "$OUT"
    return
  fi
  if [[ "$OUT" != *"$needle"* ]]; then
    fail "${name}：输出未包含下一步提示「${needle}」"
    printf '%s\n' "$OUT"
    return
  fi
  pass "${name}：结论、标记与下一步提示都正确"
}

printf '▶ check-gtk-unblock.sh 自测\n'

expect_fixture blocked \
  '结论：blocked' \
  '<!-- gtk-unblock-watch:verdict=blocked;tauri=^0.18;muda=^0.18;tao=^0.18 -->' \
  '不要 dismiss'

expect_fixture partial \
  '结论：partial' \
  '<!-- gtk-unblock-watch:verdict=partial;tauri=^0.18;muda=none;tao=^0.18 -->' \
  'cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target aarch64-apple-darwin'

expect_fixture unblocked \
  '结论：unblocked' \
  '<!-- gtk-unblock-watch:verdict=unblocked;tauri=^0.19;muda=none;tao=^0.19 -->' \
  'cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target x86_64-pc-windows-msvc'

# --- --dry-run 不得调用 gh ---
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/cca-gtk.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
sentinel="${tmpdir}/gh-called"

cat > "${tmpdir}/gh" <<'SH'
#!/usr/bin/env bash
printf 'gh was called\n' >> "${GH_SENTINEL:?}"
exit 99
SH
chmod +x "${tmpdir}/gh"

set +e
OUT="$(PATH="${tmpdir}:${PATH}" GH_SENTINEL="${sentinel}" GH_TOKEN='' \
  "${CHECK}" --fixture "${FIXTURES}/partial.json" --dry-run 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 0 ]]; then
  fail "--dry-run：退出码 ${RC}（应为 0）"
  printf '%s\n' "$OUT"
elif [[ -e "$sentinel" ]]; then
  fail '--dry-run：调用了 gh（哨兵被写入）'
else
  missing=0
  for needle in '### 上游 gtk 要求检查' 'verdict=partial' 'muda=none'; do
    if [[ "$OUT" != *"$needle"* ]]; then
      fail "--dry-run：输出未包含「${needle}」"
      missing=1
      break
    fi
  done
  if [[ "$missing" -eq 0 ]]; then
    pass '--dry-run：打印评论正文且未调用 gh'
  fi
fi

# --- 网络路径：用假 curl 验证「元数据 → 依赖列表」的解析与记录拼装 ---
#
# 夹具路径与网络路径的记录拼装方式不同（前者直接读 JSON，后者要先查版本号、
# 再用版本号拼依赖 URL）。只测夹具漏掉过一次真实缺陷：网络路径少拼了 crate
# 字段，结果每行都被当成未知 crate。假 curl 让这条路径在离线测试里可执行。
mkdir -p "${tmpdir}/fakecurl"
cat > "${tmpdir}/fakecurl/curl" <<'SH'
#!/usr/bin/env bash
url=""
for arg in "$@"; do
  url="$arg"
done
case "$url" in
  */api/v1/crates/tauri)
    printf '%s\n' '{"crate":{"max_stable_version":"2.12.5"}}'
    ;;
  */api/v1/crates/tauri/2.12.5/dependencies)
    printf '%s\n' '{"dependencies":[{"crate_id":"gtk","req":"^0.18"}]}'
    ;;
  */api/v1/crates/muda)
    printf '%s\n' '{"crate":{"max_stable_version":"0.21.2"}}'
    ;;
  */api/v1/crates/muda/0.21.2/dependencies)
    printf '%s\n' '{"dependencies":[{"crate_id":"gtk","req":"^0.18"}]}'
    ;;
  */api/v1/crates/tao)
    printf '%s\n' '{"crate":{"max_stable_version":"0.37.2"}}'
    ;;
  */api/v1/crates/tao/0.37.2/dependencies)
    printf '%s\n' '{"dependencies":[{"crate_id":"gtk","req":"^0.18"}]}'
    ;;
  *)
    printf '意外的 URL：%s\n' "$url" >&2
    exit 1
    ;;
esac
SH
chmod +x "${tmpdir}/fakecurl/curl"

set +e
OUT="$(PATH="${tmpdir}/fakecurl:${PATH}" GH_TOKEN='' "${CHECK}" --dry-run 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 0 ]]; then
  fail "网络路径（假 curl）：退出码 ${RC}（应为 0）"
  printf '%s\n' "$OUT"
elif [[ "$OUT" != *"verdict=blocked;tauri=^0.18;muda=^0.18;tao=^0.18"* ]]; then
  fail '网络路径（假 curl）：未按 crates.io 响应拼出正确标记'
  printf '%s\n' "$OUT"
elif [[ "$OUT" != *"2.12.5"* || "$OUT" != *"0.21.2"* || "$OUT" != *"0.37.2"* ]]; then
  fail '网络路径（假 curl）：表格未显示查询到的三个最新版本'
  printf '%s\n' "$OUT"
else
  pass '网络路径（假 curl）：解析元数据与依赖列表，记录拼装正确'
fi

# --- --comment 去重：已有相同标记时不得再留言 ---
#
# 留言去重是「不刷屏」承诺的全部实现，必须用假 gh 验证两条分支：
# 标记已存在 → 跳过；标记不存在 → 发一条。
mkdir -p "${tmpdir}/gh-dedupe"
cat > "${tmpdir}/gh-dedupe/gh" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  printf '%s\n' '<!-- gtk-unblock-watch:verdict=blocked;tauri=^0.18;muda=^0.18;tao=^0.18 -->'
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  printf 'comment was called\n' >> "${GH_SENTINEL:?}"
  exit 0
fi
printf '意外的 gh 参数：%s\n' "$*" >&2
exit 1
SH
chmod +x "${tmpdir}/gh-dedupe/gh"

dedupe_sentinel="${tmpdir}/dedupe-comment-called"
set +e
OUT="$(PATH="${tmpdir}/gh-dedupe:${PATH}" GH_TOKEN=test-token \
  GH_SENTINEL="${dedupe_sentinel}" "${CHECK}" \
  --fixture "${FIXTURES}/blocked.json" --comment 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 0 ]]; then
  fail "--comment 去重：退出码 ${RC}（应为 0）"
  printf '%s\n' "$OUT"
elif [[ -e "$dedupe_sentinel" ]]; then
  fail '--comment 去重：标记已存在却仍然发了评论'
else
  pass '--comment 去重：标记已存在时跳过留言'
fi

# --- --comment 发帖：标记不存在时必须调用 gh issue comment ---
mkdir -p "${tmpdir}/gh-post"
cat > "${tmpdir}/gh-post/gh" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  printf '%s\n' '一条与状态无关的旧评论'
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  printf 'comment was called\n' >> "${GH_SENTINEL:?}"
  printf 'https://example.invalid/comment\n'
  exit 0
fi
printf '意外的 gh 参数：%s\n' "$*" >&2
exit 1
SH
chmod +x "${tmpdir}/gh-post/gh"

post_sentinel="${tmpdir}/post-comment-called"
set +e
OUT="$(PATH="${tmpdir}/gh-post:${PATH}" GH_TOKEN=test-token \
  GH_SENTINEL="${post_sentinel}" "${CHECK}" \
  --fixture "${FIXTURES}/blocked.json" --comment 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 0 ]]; then
  fail "--comment 发帖：退出码 ${RC}（应为 0）"
  printf '%s\n' "$OUT"
elif [[ ! -e "$post_sentinel" ]]; then
  fail '--comment 发帖：标记不存在却没有调用 gh issue comment'
elif [[ "$OUT" != *"发布状态变化留言"* ]]; then
  fail '--comment 发帖：输出未说明已发布留言'
  printf '%s\n' "$OUT"
else
  pass '--comment 发帖：标记不存在时发布一条留言'
fi

# --- --comment 缺少 GH_TOKEN 必须退出 1 ---
set +e
OUT="$(GH_TOKEN='' "${CHECK}" --fixture "${FIXTURES}/blocked.json" --comment 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 1 ]]; then
  fail "--comment 缺少 GH_TOKEN：退出码 ${RC}（应为 1）"
  printf '%s\n' "$OUT"
elif [[ "$OUT" != *"GH_TOKEN"* ]]; then
  fail '--comment 缺少 GH_TOKEN：报错未说明缺少 GH_TOKEN'
  printf '%s\n' "$OUT"
else
  pass '--comment 缺少 GH_TOKEN：退出 1 并说明原因'
fi

# --- 夹具不合法必须退出 1 并指明缺了什么 ---
bad_fixture="${tmpdir}/bad.json"
printf '{"tauri":{"version":"1.0.0"}}\n' > "${bad_fixture}"

set +e
OUT="$("${CHECK}" --fixture "${bad_fixture}" 2>&1)"
RC=$?
set -e

if [[ "$RC" -ne 1 ]]; then
  fail "不合法夹具：退出码 ${RC}（应为 1）"
  printf '%s\n' "$OUT"
elif [[ "$OUT" != *"缺少"* ]]; then
  fail '不合法夹具：报错未指明缺少 crate'
  printf '%s\n' "$OUT"
else
  pass '不合法夹具：退出 1 并指明缺少 crate'
fi

printf '\n通过 %d · 失败 %d\n' "${PASSED}" "${FAILED}"
if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-gtk-unblock.sh 自测全部通过\n'
