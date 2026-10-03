#!/usr/bin/env bash
#
# check-readme-parity-test.sh —— check-readme-parity.sh 的自测
#
# 检查脚本本身也要能被验证：一个永远通过的检查比没有检查更危险——它会让人
# 以为自己受保护。这里在临时目录里搭一对**结构一致**的假 README，再逐条做变异
# （一侧多一节 / 层级变了 / 文档索引重排 / 相对链接指向断图），断言检查确实会红。
#
# 基线刻意做成**非对称**：只有英文版含一个围栏代码块里的 `# macOS Apple Silicon`
# 注释行。若检查没有跳过围栏代码块，就会把这一行当成标题、两侧层级序列不等，
# 基线当场变红——所以「跳过围栏」这件事由基线自己守着，不需要额外的变异用例。
#
# 夹具在临时目录里现场生成，不入库。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
CHECK="${SCRIPT_DIR}/check-readme-parity.sh"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-readme-parity-test.sh: 需要 python3\n' >&2
  exit 2
fi

PASSED=0
FAILED=0

# 在 $1 目录里搭一对结构一致的 README 与它们引用的最小文件集。
build_fixture() {
  local root="$1"
  mkdir -p "${root}/docs"
  : > "${root}/docs/USAGE.md"
  : > "${root}/docs/CI.md"
  : > "${root}/LICENSE"

  cat > "${root}/README.md" <<'READMEEOF'
# Title

[English](README.md) · [简体中文](README.zh-CN.md)

Intro.

## Features

- one

## Quick start

### Download

text

### Build

```bash
# macOS Apple Silicon
npm run build
```

## Documentation

| Document |
| --- |
| [docs/USAGE.md](docs/USAGE.md) |
| [docs/CI.md](docs/CI.md) |

## License

[MIT](LICENSE)
READMEEOF

  # 中文版刻意**不含**那个围栏代码块——见脚本顶部说明。
  cat > "${root}/README.zh-CN.md" <<'READMEEOF'
# 标题

[English](README.md) · [简体中文](README.zh-CN.md)

说明。

## 功能特性

- 一

## 快速开始

### 下载

文本

### 构建

```bash
npm run build
```

## 文档索引

| 文档 |
| --- |
| [docs/USAGE.md](docs/USAGE.md) |
| [docs/CI.md](docs/CI.md) |

## 许可证

[MIT](LICENSE)
READMEEOF
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

printf '▶ check-readme-parity.sh 自测\n'

# --- 基线自洽：检查必须通过（同时验证围栏代码块被跳过）---
base="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${base}"
expect_pass "${base}" "自洽基线（英文版含围栏内的 # 注释行）"

# --- 变异 1：中文版多一节 ---
mut1="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut1}"
printf '\n## 额外一节\n\n文本\n' >> "${mut1}/README.zh-CN.md"
expect_fail "${mut1}" "中文版多一节" "标题层级序列不一致"

# --- 变异 2：英文版少一节（删掉一个 h2 标题行）---
mut2="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut2}"
python3 - "${mut2}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "README.md"
lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
assert any(l.strip() == "## Documentation" for l in lines), "夹具里没有 ## Documentation"
out = [l for l in lines if l.strip() != "## Documentation"]
path.write_text("".join(out), encoding="utf-8")
PY
expect_fail "${mut2}" "英文版少一节" "标题层级序列不一致"

# --- 变异 3：层级变了（### → ##） ---
mut3="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut3}"
python3 - "${mut3}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "README.md"
text = path.read_text(encoding="utf-8")
path.write_text(text.replace("### Download", "## Download", 1), encoding="utf-8")
PY
expect_fail "${mut3}" "标题层级被改动" "标题层级序列不一致"

# --- 变异 4：把 # 注释行搬出代码围栏（真的成了标题） ---
mut4="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut4}"
printf '\n# macOS Apple Silicon\n' >> "${mut4}/README.zh-CN.md"
expect_fail "${mut4}" "围栏外的 # 注释行被当作标题" "标题层级序列不一致"

# --- 变异 5：文档索引重排 ---
mut5="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut5}"
python3 - "${mut5}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "README.zh-CN.md"
text = path.read_text(encoding="utf-8")
before = "| [docs/USAGE.md](docs/USAGE.md) |\n| [docs/CI.md](docs/CI.md) |"
after = "| [docs/CI.md](docs/CI.md) |\n| [docs/USAGE.md](docs/USAGE.md) |"
assert before in text, "夹具里没找到要重排的两行"
path.write_text(text.replace(before, after, 1), encoding="utf-8")
PY
expect_fail "${mut5}" "文档索引两侧顺序不同" "docs/ 链接的出现顺序不一致"

# --- 变异 6：引用了不存在的文件（挑一个非 docs/ 链接，避开断言 2 先命中）---
mut6="$(mktemp -d "${TMPDIR:-/tmp}/cca-readme.XXXXXX")"
build_fixture "${mut6}"
python3 - "${mut6}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "README.md"
text = path.read_text(encoding="utf-8")
assert "[MIT](LICENSE)" in text, "夹具里没有 [MIT](LICENSE)"
path.write_text(text.replace("[MIT](LICENSE)", "[MIT](LICENSE-NOPE)", 1), encoding="utf-8")
PY
expect_fail "${mut6}" "引用了不存在的文件" "引用了不存在的路径"

printf '\n通过 %d · 失败 %d\n' "${PASSED}" "${FAILED}"
if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-readme-parity.sh 自测全部通过\n'
