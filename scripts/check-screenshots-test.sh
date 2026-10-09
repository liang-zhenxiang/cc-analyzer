#!/usr/bin/env bash
#
# check-screenshots-test.sh —— check-screenshots.sh 的自测
#
# 检查脚本本身也要能被验证：一个永远通过的检查比没有检查更危险——它会让人
# 以为自己受保护。这里在临时目录里搭一套**自洽的假基线**，再逐条做变异
# （README 指向断图 / 删掉一张图 / 清单缺一个视图），断言检查确实会红。
#
# 夹具在临时目录里现场生成，不入库：完整矩阵是 15 视图 × 2 主题 × 2 引擎 = 60 张
# 占位 png，把它们提交进仓库只会增加噪音，且它们本来就不是要被引用的真图。
# 这份清单必须与 check-screenshots.sh 的 EXPECTED_VIEWS 逐项对齐——漏一个
# 新视图，自测的「自洽基线」就会因缺图而红（N1 加 error-* 时踩过）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CHECK="${SCRIPT_DIR}/check-screenshots.sh"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-screenshots-test.sh: 需要 python3\n' >&2
  exit 2
fi

PASSED=0
FAILED=0

# 在 $1 目录里搭一套自洽的假基线。
build_fixture() {
  local root="$1"
  python3 - "${root}" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
shots = root / "docs" / "screenshots"
shots.mkdir(parents=True, exist_ok=True)

views = [
    "analyzer-empty",
    "analyzer-log",
    "analyzer-log-compact",
    "analyzer-tree",
    "analyzer-report",
    "analyzer-report-full",
    "changed-files",
    "context",
    "context-empty",
    # Round N / N1：错误档两视图（与 EXPECTED_VIEWS 对齐）。
    "error-view",
    "error-events",
    "settings",
    "monitor",
    "usage",
    "usage-below",
]
themes = ["light", "dark"]
engines = ["chromium", "webkit"]

files = []
for view in views:
    for theme in themes:
        for engine in engines:
            name = f"{view}-{theme}{'' if engine == 'chromium' else '-' + engine}.png"
            files.append(name)
            (shots / name).write_bytes(b"\x89PNG\r\n\x1a\n")

(shots / "manifest.json").write_text(
    json.dumps({"commit": "testsha", "dirty": False, "files": sorted(files)}, ensure_ascii=False),
    encoding="utf-8",
)

# README 引用两张清单内的图（chromium 版，README 引的就是它）。
for readme in ["README.md", "README.zh-CN.md"]:
    (root / readme).write_text(
        "![log](docs/screenshots/analyzer-log-light.png)\n"
        "![usage](docs/screenshots/usage-light.png)\n",
        encoding="utf-8",
    )
PY
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

# 检查通过**且**输出里包含 $3——用于验证清单字段被如实显示（例如 dirty 标记），
# 而不是「只是没报错」。
expect_pass_contains() {
  local root="$1" label="$2" needle="$3"
  local out rc
  set +e
  out="$("${CHECK}" --root "${root}" 2>&1)"
  rc=$?
  set -e
  if [[ "${rc}" -ne 0 ]]; then
    printf '  ✗ %s：检查本应通过却失败了\n%s\n' "${label}" "${out}"
    FAILED=$((FAILED + 1))
    return
  fi
  if [[ "${out}" != *"${needle}"* ]]; then
    printf '  ✗ %s：检查通过了，但输出未包含「%s」\n%s\n' "${label}" "${needle}" "${out}"
    FAILED=$((FAILED + 1))
    return
  fi
  printf '  ✓ %s：检查通过且输出如实标注\n' "${label}"
  PASSED=$((PASSED + 1))
}

printf '▶ check-screenshots.sh 自测\n'

# --- 基线自洽：检查必须通过 ---
base="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${base}"
expect_pass "${base}" "自洽基线"

# --- 变异 1：README 引用一张不存在的图 ---
mut1="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut1}"
printf '![gone](docs/screenshots/does-not-exist.png)\n' >> "${mut1}/README.md"
expect_fail "${mut1}" "README 引用不存在的图" "引用了不存在的截图"

# --- 变异 2：清单仍列着某张图，但文件被删了 ---
mut2="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut2}"
rm -f "${mut2}/docs/screenshots/analyzer-tree-dark.png"
expect_fail "${mut2}" "删掉一张被清单引用的图" "不存在"

# --- 变异 3：清单缺一个视图（文件还在，只是没进清单） ---
mut3="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut3}"
python3 - "${mut3}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "manifest.json"
data = json.loads(path.read_text(encoding="utf-8"))
# 移除 usage 视图的四张图（缺一个视图），其余不动。
data["files"] = [f for f in data["files"] if not f.startswith("usage-")]
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut3}" "清单缺一个视图" "缺视图"

# --- 变异 4：清单里的文件不在期望矩阵里（视图改名残留） ---
mut4="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut4}"
python3 - "${mut4}" <<'PY'
import json
import pathlib
import sys

shots = pathlib.Path(sys.argv[1]) / "docs" / "screenshots"
path = shots / "manifest.json"
data = json.loads(path.read_text(encoding="utf-8"))
# 加一张「视图已下线」的残留图。
(shots / "legacy-view-light.png").write_bytes(b"\x89PNG\r\n\x1a\n")
data["files"] = sorted(set(data["files"] + ["legacy-view-light.png"]))
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut4}" "清单里有矩阵外的残留图" "清单外"

# --- 变异 5：清单文件缺失 ---
mut5="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut5}"
rm -f "${mut5}/docs/screenshots/manifest.json"
expect_fail "${mut5}" "缺少截图清单" "缺少截图清单"

# --- 变异 6：清单标记为 dirty（带未提交改动出图）→ 检查通过，且输出如实标注 ---
mut6="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut6}"
python3 - "${mut6}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "manifest.json"
data = json.loads(path.read_text(encoding="utf-8"))
data["commit"] = "testsha+dirty"
data["dirty"] = True
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_pass_contains "${mut6}" "清单标记为 dirty 时如实显示" "未提交改动"

printf '\n通过 %d · 失败 %d\n' "${PASSED}" "${FAILED}"
if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-screenshots.sh 自测全部通过\n'
