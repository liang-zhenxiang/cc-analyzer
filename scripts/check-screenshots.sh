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

# 截图套必须覆盖的视图。它与 web/e2e/screenshots.spec.ts 生成的视图一一对应；
# 这里独立列一份是**故意的**——若截图脚本不再生成某个视图，只有这份独立清单
# 才能把「套里少了一个视图」抓住（清单自己是不会报告自己缺项的）。
EXPECTED_VIEWS = [
    "analyzer-empty",
    "analyzer-log",
    "analyzer-tree",
    "analyzer-report",
    "analyzer-report-full",
    "settings",
    "monitor",
    "usage",
    "usage-below",
    # Round J：上下文标签页三视图——含压缩行的日志表、上下文取证打开态、
    # 无压缩会话的「有数据的零」。analyzer-log 保留为无压缩的基础形态。
    "analyzer-log-compact",
    "context",
    "context-empty",
    # Round N / N1：错误档两视图——首屏（KPI 行 + 趋势主角）与滚到底
    # （分布切面 + 事件列表）。
    "error-view",
    "error-events",
    # Round N / N2：改动标签页——展开首文件后的完整形态（行、徽标、
    # 展开区记录清单与口径脚注）。
    "changed-files",
]
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

# 1a. 清单必须覆盖完整矩阵。
missing = sorted(expected - listed)
if missing:
    fail("截图套缺视图：" + "，".join(missing) + "（清单未覆盖全部 视图 × 主题 × 引擎）")

# 1b. 清单里不该有矩阵之外的文件（视图改名 / 下线后的残留）。
extra = sorted(listed - expected)
if extra:
    fail("截图套里有清单外的文件（视图已改名或下线？）：" + "，".join(extra))

# 1c. 清单里每张图都要真实存在。
for name in sorted(listed):
    if not (shots / name).exists():
        fail(f"清单里的 {name} 在 docs/screenshots/ 下不存在（清单与文件已脱节）")

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
