#!/usr/bin/env bash
#
# check-e2e-mock-version-test.sh —— check-e2e-mock-version.sh 的自测
#
# 检查脚本本身也要能被验证：一个永远通过的检查比没有检查更危险。这里在
# 临时目录里搭一套自洽的假结构，再做三条变异（场景工厂写死版本 / 删掉
# package.json 读取机制 / 版本徽章断言写死），断言检查确实会红。
#
# 夹具在临时目录里现场生成，不入库：它只需要形状像，不需要真的能跑。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CHECK="${SCRIPT_DIR}/check-e2e-mock-version.sh"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-e2e-mock-version-test.sh: 需要 python3\n' >&2
  exit 2
fi

PASSED=0
FAILED=0

# 在 $1 目录里搭一套自洽的假基线：package.json + 从它读版本的场景工厂
# + 动态构造的版本徽章断言。
build_fixture() {
  local root="$1"
  mkdir -p "${root}/web/e2e"
  cat >"${root}/web/package.json" <<'JSON'
{
  "name": "cc-analyzer-web",
  "version": "0.13.0-beta.2"
}
JSON
  cat >"${root}/web/e2e/fixtures.ts" <<'TS'
import { readFileSync } from "node:fs";
export const APP_VERSION: string = (() => {
  const parsed: unknown = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
  return String(parsed);
})();
export function defaultScenario() {
  return { updater: { currentVersion: APP_VERSION } };
}
TS
  cat >"${root}/web/e2e/update-settings.spec.ts" <<'TS'
import { APP_VERSION } from "./fixtures";
const expected = new RegExp(`当前版本 v${APP_VERSION.replace(/\./g, "\\.")}`);
TS
}

# 断言检查会红，并且红的原因包含 $3 这段文字。
expect_fail() {
  local root="$1" label="$2" needle="$3"
  local out rc
  set +e
  out="$("${CHECK}" --root "${root}" 2>&1)"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    printf '  ✗ %s：检查却通过了（应当失败）\n' "${label}"
    FAILED=$((FAILED + 1))
    return
  fi
  if [[ -n "${needle}" && "${out}" != *"${needle}"* ]]; then
    printf '  ✗ %s：检查失败了，但原因不对（未包含「%s」）\n%s\n' "${label}" "${needle}" "${out}"
    FAILED=$((FAILED + 1))
    return
  fi
  printf '  ✓ %s：检查如预期失败\n' "${label}"
  PASSED=$((PASSED + 1))
}

expect_pass() {
  local root="$1" label="$2"
  local out rc
  set +e
  out="$("${CHECK}" --root "${root}" 2>&1)"
  rc=$?
  set -e
  if [[ "${rc}" -eq 0 ]]; then
    printf '  ✓ %s：检查通过\n' "${label}"
    PASSED=$((PASSED + 1))
  else
    printf '  ✗ %s：检查本应通过却失败了\n%s\n' "${label}" "${out}"
    FAILED=$((FAILED + 1))
  fi
}

printf '▶ check-e2e-mock-version.sh 自测\n'

# --- 基线自洽：检查必须通过 ---
base="$(mktemp -d "${TMPDIR:-/tmp}/cca-ver.XXXXXX")"
build_fixture "${base}"
expect_pass "${base}" "自洽基线"

# --- 变异 1：场景工厂把 currentVersion 写回字面量 ---
mut1="$(mktemp -d "${TMPDIR:-/tmp}/cca-ver.XXXXXX")"
build_fixture "${mut1}"
sed -i '' 's/currentVersion: APP_VERSION/currentVersion: "0.10.0"/' "${mut1}/web/e2e/fixtures.ts"
expect_fail "${mut1}" "场景工厂写死版本" "写成了字面量"

# --- 变异 2：APP_VERSION 退化成常量（不再读 package.json）。
#     值此刻与 package.json 相同——这正是要抓的形态：现在不漂，下次发版照漂。 ---
mut2="$(mktemp -d "${TMPDIR:-/tmp}/cca-ver.XXXXXX")"
build_fixture "${mut2}"
python3 - "${mut2}" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]) / "web" / "e2e" / "fixtures.ts"
text = p.read_text(encoding="utf-8")
old = 'export const APP_VERSION: string = (() => {\n  const parsed: unknown = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));\n  return String(parsed);\n})();'
assert old in text, "fixture shape drifted; update this mutation"
p.write_text(text.replace(old, 'export const APP_VERSION: string = "0.13.0-beta.2";'), encoding="utf-8")
PY
expect_fail "${mut2}" "APP_VERSION 退化为常量" "package.json 读取"

# --- 变异 3：版本徽章断言写死版本号 ---
mut3="$(mktemp -d "${TMPDIR:-/tmp}/cca-ver.XXXXXX")"
build_fixture "${mut3}"
cat >>"${mut3}/web/e2e/update-settings.spec.ts" <<'TS'
await expect(page.getByRole("button", { name: /当前版本 v0\.10\.0/ })).toBeVisible();
TS
expect_fail "${mut3}" "版本徽章断言写死" "写死了版本徽章断言"

printf '\n通过 %d · 失败 %d\n' "${PASSED}" "${FAILED}"
if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-e2e-mock-version.sh 自测全部通过\n'
