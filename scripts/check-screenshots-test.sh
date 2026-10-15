#!/usr/bin/env bash
#
# check-screenshots-test.sh —— check-screenshots.sh 的自测
#
# 检查脚本本身也要能被验证：一个永远通过的检查比没有检查更危险——它会让人
# 以为自己受保护。这里在临时目录里搭一套**自洽的假基线**，再逐条做变异
# （README 指向断图 / 删掉一张图 / 清单缺一个视图 / 视图清单缺一个视图），
# 断言检查确实会红。
#
# 夹具在临时目录里现场生成，不入库：完整矩阵是 20 视图 × 2 主题 × 2 引擎 = 80 张
# 占位 png，把它们提交进仓库只会增加噪音，且它们本来就不是要被引用的真图。
#
# **视图名不再在本文件里硬编码**（Issue #196）：假基线的视图轴直接抄仓库里
# 那份权威清单 docs/screenshots/views.json，再把它拷进夹具根。原先这里另有一份
# `views` 列表必须与 check-screenshots.sh 的 EXPECTED_VIEWS 逐项手工对齐，
# #193 加 usage-day 时正是这一处漏了。现在两边同源，天然不会漂。
#
# 但「同源」有个副作用必须防：如果本自测只是把权威清单原样喂给检查，那
# 「检查脚本读没读清单」这件事就没被验证——检查若退化成读别的常量，自测照过。
# 所以下面有一条**专属变异**：把夹具里的 views.json 改掉（加一个视图），
# 断言检查确实红了。这条变异证明的是「权威清单真的被当成视图轴在用」。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly ROOT
CHECK="${SCRIPT_DIR}/check-screenshots.sh"
# 仓库里的权威视图清单——假基线的视图轴由它生成。
SRC_VIEWS="${ROOT}/docs/screenshots/views.json"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-screenshots-test.sh: 需要 python3\n' >&2
  exit 2
fi

# 权威清单必须在场：它缺席时下面每条变异都会「红得莫名其妙」，
# 那正是本项目最想避免的失败形态（红在别处、第一眼像脚本坏了）。
if [[ ! -f "${SRC_VIEWS}" ]]; then
  printf 'check-screenshots-test.sh: 找不到权威视图清单 %s\n' "${SRC_VIEWS}" >&2
  exit 2
fi

PASSED=0
FAILED=0

# 在 $1 目录里搭一套自洽的假基线。$2（可选）是权威视图清单的路径，默认用仓库里
# 那份；留出这个口子是为了将来要构造「清单本身不同」的夹具时不必改这里。
build_fixture() {
  local root="$1"
  local views_src="${2:-${SRC_VIEWS}}"
  python3 - "${root}" "${views_src}" <<'PY'
import json
import pathlib
import shutil
import sys

root = pathlib.Path(sys.argv[1])
views_src = pathlib.Path(sys.argv[2])
shots = root / "docs" / "screenshots"
shots.mkdir(parents=True, exist_ok=True)

# 视图轴来自仓库里的权威清单——不在本文件里另抄一份。
views = json.loads(views_src.read_text(encoding="utf-8"))["views"]
# 权威清单也进夹具：检查脚本要读它。
shutil.copyfile(views_src, shots / "views.json")

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
# 用清单里的**前两个**视图，而不是写死 analyzer-log / usage——写死会让夹具
# 随权威清单改名而碎，且碎法看起来像检查脚本坏了。
for readme in ["README.md", "README.zh-CN.md"]:
    (root / readme).write_text(
        "".join(
            f"![{v}](docs/screenshots/{v}-light.png)\n" for v in views[:2]
        ),
        encoding="utf-8",
    )

# 夹具也要有 spec：检查脚本第 0 段会扫它的视图声明做双向对齐。
# 每个视图都按「常量 = declareView(字面量)」的形态声明——与真 spec 一致。
# 少一个声明，检查就会报「清单里有、spec 没声明」，把其它变异的结论带偏。
spec = root / "web" / "e2e" / "screenshots.spec.ts"
spec.parent.mkdir(parents=True, exist_ok=True)
spec.write_text(
    "// 夹具 spec：只为让检查脚本的声明↔清单对齐有东西可扫。\n"
    + "".join(
        f'const V{i} = declareView("{v}");\n' for i, v in enumerate(views)
    ),
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
# 删哪张图从权威清单里取（第 3 个视图的深色 chromium 版），不写死视图名——
# 写死会让夹具随权威清单改名而碎，且碎法看起来像检查脚本坏了。
victim="$(python3 -c 'import json,pathlib,sys;print(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["views"][2] + "-dark.png")' "${SRC_VIEWS}")"
rm -f "${mut2}/docs/screenshots/${victim}"
expect_fail "${mut2}" "删掉一张被清单引用的图" "不存在"

# --- 变异 3：清单缺一个视图（文件还在，只是没进清单） ---
#     同时验证报错**指名道姓**：必须说出缺的是哪个视图，而不只是「缺视图」。
mut3="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut3}"
victim_view="$(python3 -c 'import json,pathlib,sys;print(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))["views"][0])' "${SRC_VIEWS}")"
python3 - "${mut3}" "${victim_view}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "manifest.json"
view = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
# 移除该视图的四张图（缺一个视图），其余不动。
data["files"] = [f for f in data["files"] if not f.startswith(view + "-")]
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut3}" "清单缺一个视图" "缺视图"
expect_fail "${mut3}" "清单缺视图时指名道姓" "${victim_view}"

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

# --- 变异 4b：磁盘上有矩阵外的图，但**清单里也没有**它 ---
#
# 变异 4 走的是「清单里多一项」那条路（1b）。这里走**磁盘**那条路（1d）：
# 图躺在 docs/screenshots/ 里，manifest 与 views.json 都不提它——这正是
# 「视图从权威清单删掉、e2e 没重跑、图也没删」的形态，1b 看不见（它只看清单），
# 只有 1d 能抓。少了这条变异，「磁盘残留」这条路径就没有回归保护。
mut4b="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut4b}"
python3 - "${mut4b}" <<'PY'
import pathlib
import sys

shots = pathlib.Path(sys.argv[1]) / "docs" / "screenshots"
# 只往磁盘放图，不动 manifest.json —— 清单与权威矩阵里都没有它。
(shots / "legacy-view-light.png").write_bytes(b"\x89PNG\r\n\x1a\n")
PY
expect_fail "${mut4b}" "磁盘上的残留图（清单里没有）" "权威矩阵之外的图"

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

# --- 变异 7：权威视图清单被改（新增一个视图，但图没出）→ 检查必须红 ---
#
# 这条变异守的是**收敛本身**：前面 6 条变异里，夹具的视图轴与检查脚本读的
# 是同一份文件，所以即便检查脚本退化成「读别的常量」也可能照过。这里把夹具里
# 的 views.json 改掉（加一个没出过图的视图），断言检查确实报缺视图——证明
# 权威清单真的被当成视图轴在用，而不只是被拷来拷去。
mut7="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut7}"
python3 - "${mut7}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "views.json"
data = json.loads(path.read_text(encoding="utf-8"))
data["views"].append("brand-new-view")
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut7}" "权威清单新增视图但没出图" "brand-new-view"

# --- 变异 8：权威视图清单缺失 → 检查必须红，且指明缺的是哪份文件 ---
mut8="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut8}"
rm -f "${mut8}/docs/screenshots/views.json"
expect_fail "${mut8}" "缺少权威视图清单" "views.json"

# --- 变异 9：视图名与「视图+主题」文件名规则冲突（以 -light 结尾）→ 检查必须红 ---
#
# 视图名 `usage-light` 与视图 `usage` 的浅色图会撞成同一个文件名。这类冲突在
# 矩阵层面是不可逆的（从文件名反推不出视图），所以清单形状要当场拦下。
mut9="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut9}"
python3 - "${mut9}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "views.json"
data = json.loads(path.read_text(encoding="utf-8"))
data["views"].append("usage-light")
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut9}" "视图名以 -light 结尾会与主题冲突" "以 -light/-dark 结尾"

# --- 变异 10：清单里有、spec 没声明 → 该视图永远不会被出图 ---
#
# 这条守的是「收敛成单一权威」之后剩下的那个风险面：views.json 是权威，但 spec
# 仍要按名字声明才能出图。只往清单里加名字、spec 不加声明，就重新回到了 #196
# 的老形态（清单与出图脱钩）。报错必须**指名道姓**说出是哪个视图。
mut10="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut10}"
python3 - "${mut10}" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "docs" / "screenshots" / "views.json"
data = json.loads(path.read_text(encoding="utf-8"))
data["views"].append("ghost-view")
path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
PY
expect_fail "${mut10}" "清单里有但 spec 没声明" "ghost-view"

# --- 变异 11：spec 声明了、清单里没有 → 出了图也不在权威矩阵里 ---
mut11="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut11}"
cat >>"${mut11}/web/e2e/screenshots.spec.ts" <<'TS'
const V_GHOST = declareView("unlisted-view");
TS
expect_fail "${mut11}" "spec 声明了但清单里没有" "unlisted-view"

# --- 变异 12：spec 文件缺失 → 检查必须红，且指明缺的是哪份文件 ---
#
# 少了这条，声明↔清单对齐会在「spec 被改名/挪走」时静默失效——那正是本项目
# 最想避免的失败形态（检查看起来还在、其实已经不看东西了）。
mut12="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut12}"
rm -f "${mut12}/web/e2e/screenshots.spec.ts"
expect_fail "${mut12}" "缺少截图 spec" "找不到截图 spec"

# --- 变异 13：spec 里一条声明都没有 → 检查必须红 ---
#
# 防止「声明方式改成别的写法」时检查静默通过：正则一条都扫不到时，若直接拿
# 空集去比对，方向一的报错虽然会亮，但方向二会空转。这里把 spec 清空成不含
# 任何声明的形态，断言检查明确报出「没有任何声明」而不是误报成别的。
mut13="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut13}"
printf '// 没有任何 view 声明\n' >"${mut13}/web/e2e/screenshots.spec.ts"
expect_fail "${mut13}" "spec 里没有任何视图声明" "没有任何"

# --- 变异 14：注释里的调用示例不得被当成真声明 ---
#
# 检查用正则扫 spec。文档注释里写出完整的调用示例（本项目注释写得密）会被
# 当成真声明扫进来，报出「声明了不在清单里的视图：x」这种假警报——实测踩过。
# 这条把「注释与代码的区分」变成回归保护：夹具里加一条注释示例，检查必须**仍绿**。
mut14="$(mktemp -d "${TMPDIR:-/tmp}/cca-shots.XXXXXX")"
build_fixture "${mut14}"
cat >>"${mut14}/web/e2e/screenshots.spec.ts" <<'TS'
// 说明：调用点写成 const V_X = declareView("x") 这种形态即可。
TS
expect_pass "${mut14}" "注释里的调用示例不被当成声明"

printf '\n通过 %d · 失败 %d\n' "${PASSED}" "${FAILED}"
if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
printf '✓ check-screenshots.sh 自测全部通过\n'
