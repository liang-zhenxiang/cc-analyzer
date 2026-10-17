#!/usr/bin/env bash
#
# check-screenshots.sh —— 视觉基线一致性检查
#
# 断言三件事，任何一件不成立就红：
#   1. 截图套清单（docs/screenshots/manifest.json）覆盖**全部**视图 × 主题 × 引擎，
#      且清单里每张图都真实存在于 docs/screenshots/。
#   2. README.md / README.zh-CN.md 里引用的每一张 docs/screenshots/*.png
#      都真实存在、且出现在清单里。
#   3. docs/screenshots/ 里没有清单外（视图已改名 / 残留下线）的图。
#
# 视图名的**单一权威**是 docs/screenshots/views.json（Issue #196）：它同时被
# 本脚本、web/e2e/screenshots.spec.ts 与 scripts/check-screenshots-test.sh 读取。
# 在这之前视图清单硬编码在三处，新增一个视图要逐项手工对齐，#193 加 usage-day
# 时漏了一处，CI 上「视觉基线一致性」5 秒即红，且第一眼像是检查脚本自己坏了。
# 现在新增/改名/下线一个视图**只需改 views.json 一处**（spec 侧的声明由
# `--list` 收集期的对齐断言复核）。
#
# 为什么需要它：docs/screenshots/ 是 README 的门面，但它的更新全靠「人记得重出图」。
# 上一轮就发生过——目录里混着相隔一天的**两代**截图，同一批里 `usage-dark.png`
# 甚至还没有计费卡片，而 README 引的正是这批图。人眼不会逐张比对代际。
# 有了这份清单与检查，「README 引用断图」与「截图套缺视图」会在本地（./scripts/lint.sh）
# 与 CI 上自动失败，而不是靠谁记得。
#
# 用法：
#   ./scripts/check-screenshots.sh                # 检查仓库根
#   ./scripts/check-screenshots.sh --root <dir>   # 检查指定目录（自测用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || { printf 'check-screenshots.sh: --root 需要一个目录参数\n' >&2; exit 2; }
      ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    *)
      printf 'check-screenshots.sh: 未知参数：%s\n用法：./scripts/check-screenshots.sh [--root <dir>]\n' "$1" >&2
      exit 2
      ;;
  esac
done
readonly ROOT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-screenshots.sh: 需要 python3 来解析清单与 README\n' >&2
  exit 2
fi

python3 - "${ROOT}" <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
shots = root / "docs" / "screenshots"
manifest_path = shots / "manifest.json"
# 视图清单的**单一权威**（Issue #196）。原先这里有一份 EXPECTED_VIEWS 硬编码、
# screenshots.spec.ts 有一份、check-screenshots-test.sh 还有一份，三处必须
# 逐项手工对齐——#193 加 usage-day 时第三处漏了，CI 5 秒即红。
# 现在三处都读这个文件：本脚本用 json.load，spec 用 readFileSync。
views_path = shots / "views.json"
# spec 里声明视图名的地方；本脚本靠它做「声明 ↔ 清单」双向对齐（见 0. 段）。
SPEC_PATH = root / "web" / "e2e" / "screenshots.spec.ts"
# 匹配 spec 里**真正的声明**：`const V_X = declareView("名字");`。
#
# 为什么不能只靠正则的宽松版：本项目注释写得密，文档注释里会出现
# 「调用点写成 const V_X = declareView("x") 这种形态」这类示例。若只匹配
# `= declareView("…")`，示例会被当成真声明扫进来，报出「声明了不在清单里的
# 视图：x」这种假警报——实测踩过。所以两层一起用：
#   1. 行级先排除注释行（`//` 与 `*` 开头）——这是根治，注释里的示例不再参与；
#   2. 名字限定字符集（小写字母/数字/连字符，须以字母数字开头）。
# 两者都必要：只做第 2 层挡不住名字合法的示例（如上面的 `x`），只做第 1 层则
# 挡不住行尾注释里的示例。
DECLARE_PATTERN = re.compile(r"=\s*declareView\(\"([a-z0-9][a-z0-9-]*)\"\)")
THEMES = ["light", "dark"]
ENGINES = ["chromium", "webkit"]
README_FILES = ["README.md", "README.zh-CN.md"]
REF_PATTERN = re.compile(r"docs/screenshots/([A-Za-z0-9._-]+\.png)")


def fail(message: str) -> "None":
    print(f"  ✗ {message}")
    sys.exit(1)


def file_name(view: str, theme: str, engine: str) -> str:
    # chromium 不带后缀（README 引的就是它）；其余引擎加 -<engine>，
    # 与 screenshots.spec.ts 的文件命名规则一致。
    suffix = "" if engine == "chromium" else f"-{engine}"
    return f"{view}-{theme}{suffix}.png"


if not views_path.exists():
    fail(
        "缺少截图视图清单 docs/screenshots/views.json——它是视图名（视图 × 主题 × 引擎"
        "矩阵的视图轴）的单一权威，与 web/e2e/screenshots.spec.ts 共用，不能缺席"
    )

try:
    views_manifest = json.loads(views_path.read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    fail(f"截图视图清单 docs/screenshots/views.json 不是合法 JSON：{exc}")

EXPECTED_VIEWS = views_manifest.get("views")
if not isinstance(EXPECTED_VIEWS, list) or not EXPECTED_VIEWS:
    fail("截图视图清单 docs/screenshots/views.json 里没有非空的 views 列表")

# 形状校验：每个视图名都要能与「-light/-dark」拼接成合法文件名而不产生歧义。
# 名字里出现 `-light` / `-dark` 这类后缀会让「视图 × 主题」在文件名层面不可逆地
# 混淆（视图 `usage-light` 与视图 `usage` 的浅色图同名），所以当场拦下。
for view in EXPECTED_VIEWS:
    if not isinstance(view, str) or not view:
        fail("截图视图清单 docs/screenshots/views.json 的 views 里有非字符串或空串项")
    if re.search(r"-(light|dark)$", view):
        fail(
            f"截图视图清单里的视图名 {view} 以 -light/-dark 结尾——"
            "它会与「视图 + 主题」的文件名规则冲突，请改名"
        )

if len(set(EXPECTED_VIEWS)) != len(EXPECTED_VIEWS):
    duplicates = sorted({v for v in EXPECTED_VIEWS if EXPECTED_VIEWS.count(v) > 1})
    fail("截图视图清单 docs/screenshots/views.json 里有重复的视图名：" + "，".join(duplicates))

# 0. 声明 ↔ 清单 双向对齐。
#
#    这是「收敛成单一权威」之后**唯一**剩下的一致性风险面：views.json 是权威，
#    但 spec 仍要按名字声明才能出图，两边脱钩就又回到 #196 的老问题。spec 侧
#    有一条同语义的 Playwright 断言，但它带 `test.skip(!process.env.SCREENSHOTS)`，
#    而 CI 的 screenshots-baseline job **只跑本脚本与自测、根本不跑 Playwright**
#    （`SCREENSHOTS` 在 CI 里从没被设置过）——也就是说那条断言在 CI 里是 skipped，
#    装饰性的。所以这里在 shell 侧独立复核一遍，让它真正进 CI。
#
#    为什么能直接扫源码：declareView 的调用形态是固定的 `= declareView("x")`，
#    正则足够可靠，也因此**不需要**在 shell 里跑 TypeScript（那要么引入依赖，
#    要么自己剥语法，都违反「不引入新的 npm 依赖」）。
if not SPEC_PATH.exists():
    fail(f"找不到截图 spec {SPEC_PATH.relative_to(root)}——它是视图声明的来源，不能缺席")

spec_text = SPEC_PATH.read_text(encoding="utf-8")
# 先剥掉注释行（`//` 与块注释延续行 `*`），再扫声明——注释里的调用示例不算数。
# 只做行级判断：本项目的声明一律独占一行写在顶层，不会有「代码行尾跟注释里
# 再放一个声明」的形态；行级足够，且不必引入 TS 解析器（那要新依赖）。
spec_code_lines = [
    line
    for line in spec_text.splitlines()
    if not line.lstrip().startswith(("//", "*", "/*"))
]
declared = DECLARE_PATTERN.findall("\n".join(spec_code_lines))
if not declared:
    fail(
        f"{SPEC_PATH.relative_to(root)} 里没有任何 declareView(\"…\") 声明——"
        "要么声明方式改了（本检查需要同步），要么视图声明被整体删掉了"
    )

# 方向一：清单里有、spec 没声明 → 这个视图永远不会被出图。
undeclared = [v for v in EXPECTED_VIEWS if v not in declared]
if undeclared:
    fail(
        f"views.json 里有 {len(undeclared)} 个视图在 spec 里没有声明："
        f"{'，'.join(undeclared)}——它们永远不会被出图。"
        "请在本文件里加 declareView 与出图，或从 views.json 里移除"
    )

# 方向二：spec 声明了、清单里没有 → 出了图也不在权威矩阵里（矩阵会判它多余）。
unlisted = [v for v in declared if v not in EXPECTED_VIEWS]
if unlisted:
    fail(
        f"spec 声明了 {len(unlisted)} 个不在 views.json 里的视图："
        f"{'，'.join(sorted(set(unlisted)))}——请把它们加进 docs/screenshots/views.json"
    )

# 重复声明：同一视图声明两次，出图会互相覆盖，且长度比对会失去意义。
if len(set(declared)) != len(declared):
    dup = sorted({v for v in declared if declared.count(v) > 1})
    fail("spec 里有重复的视图声明：" + "，".join(dup))

if not manifest_path.exists():
    fail(
        "缺少截图清单 docs/screenshots/manifest.json——"
        "用 SCREENSHOTS=1 npm --prefix web run test:e2e 重出截图后再提交"
    )

try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    fail(f"截图清单不是合法 JSON：{exc}")

listed = manifest.get("files")
if not isinstance(listed, list) or not listed:
    fail("截图清单里没有非空的 files 列表")
listed = set(listed)

expected = {file_name(v, t, e) for v in EXPECTED_VIEWS for t in THEMES for e in ENGINES}

# 1a. 清单必须覆盖完整矩阵。报错要**指名道姓**：只说「缺视图」而不说是哪个视图，
#     读的人还得自己 diff 两张列表；这里把缺失的图名与它对应的**视图名**都给出来。
missing = sorted(expected - listed)
if missing:
    missing_set = set(missing)
    missing_views = [
        v
        for v in EXPECTED_VIEWS
        if any(file_name(v, t, e) in missing_set for t in THEMES for e in ENGINES)
    ]
    hint = f"涉及视图：{'，'.join(missing_views)}。" if missing_views else ""
    fail(
        f"截图套缺视图：{hint}缺图：{'，'.join(missing)}"
        "（清单未覆盖全部 视图 × 主题 × 引擎；"
        "用 SCREENSHOTS=1 npm --prefix web run test:e2e 重出图后再提交）"
    )

# 1b. 清单里不该有矩阵之外的文件（视图改名 / 下线后的残留）。
extra = sorted(listed - expected)
if extra:
    fail("截图套里有清单外的文件（视图已改名或下线？）：" + "，".join(extra))

# 1c. 清单里每张图都要真实存在。
for name in sorted(listed):
    if not (shots / name).exists():
        fail(f"清单里的 {name} 在 docs/screenshots/ 下不存在（清单与文件已脱节）")

# 1d. 反向：磁盘上的图必须都在权威矩阵里（Issue #196 的收口）。
#
#     为什么 1a/1b 盖不住这一条：1a 只看 manifest 缺不缺图，1b 只看 manifest 有没有
#     多余项。若把某个视图从 views.json 删掉、而 e2e 没有重跑（manifest 与磁盘都
#     还留着旧图），1a 报的是**别的**缺图、1b 也不响——读的人会以为问题在别处，
#     根本看不出「被删的那个视图还有残留」。所以这里直接比对**磁盘事实**：
#     目录里存在、而权威矩阵里没有的 PNG，就是下线/改名后的残留。
#     与 1b 的区别在数据源：1b 看 manifest（派生物，可能没重跑），这里看磁盘。
#     两条都留，因为「manifest 未重跑」与「文件未删」是两种独立的漂移。
stray = [path.name for path in sorted(shots.glob("*.png")) if path.name not in expected]
if stray:
    # 从文件名反推视图名只是**提示**（`foo-light-webkit.png` → `foo`），
    # 不保证正确——但足以让读的人一眼定位到是哪个视图的残留。
    stray_views = sorted({name.split("-")[0] for name in stray})
    fail(
        f"docs/screenshots/ 里有权威矩阵之外的图：{'，'.join(stray)}"
        f"（所属视图名推测：{'，'.join(stray_views)}）。"
        "若是下线/改名，请删掉这些残留并重跑 e2e 重出清单；"
        "若是新视图，请把它加进 docs/screenshots/views.json，不要只放图"
    )

# 2. README 引用必须存在且在清单内。
referenced: set[str] = set()
for readme in README_FILES:
    path = root / readme
    if not path.exists():
        fail(f"找不到 {readme}")
    referenced.update(REF_PATTERN.findall(path.read_text(encoding="utf-8")))

if not referenced:
    fail("README 里没有任何 docs/screenshots/*.png 引用——这条检查无从判断引用是否有效")

for name in sorted(referenced):
    if not (shots / name).exists():
        fail(f"README 引用了不存在的截图：docs/screenshots/{name}")
    if name not in listed:
        fail(f"README 引用的 {name} 不在截图清单里——重出截图后再提交")

commit = manifest.get("commit", "未知")
dirty = bool(manifest.get("dirty"))
origin = f"生成于 {commit}"
if dirty:
    # 带未提交改动出图时，SHA 后面会跟 +dirty——这批图**不**等于该提交里的图，
    # 说清楚，免得「生成于 41b8200」被读成「就是 41b8200 那一代」。
    origin += "（截图目录有未提交改动，非纯 HEAD 产物）"
print(
    f"  ✓ 截图基线一致：{len(expected)} 张"
    f"（{len(EXPECTED_VIEWS)} 视图 × {len(THEMES)} 主题 × {len(ENGINES)} 引擎），"
    f"README 引用 {len(referenced)} 张，{origin}"
)
PY
