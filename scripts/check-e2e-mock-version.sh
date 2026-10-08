#!/usr/bin/env bash
#
# check-e2e-mock-version.sh —— e2e 版本桩防漂移检查
#
# 断言三件事，任何一件不成立就红：
#   1. web/e2e/fixtures.ts 的场景工厂不写死 currentVersion——版本必须读
#      web/package.json（APP_VERSION）。写死会让每一版归档截图的顶栏版本
#      徽章都停在旧版本：v0.10.0 那一代就是桩忘了跟发版，截图在撒谎而
#      没人发现。
#   2. fixtures.ts 里存在「从 package.json 读版本」的机制。只禁字面量不够：
#      把 APP_VERSION 本身写成常量，此刻不漂、下次发版照漂。
#   3. web/e2e/ 下没有「当前版本 v<数字>」形式的写死断言。版本徽章断言
#      与动态桩脱节时，要等下一次发版才会红——那是发版后才发现的漂移。
#
# 「桩版本 = package.json 版本」这条一致性由 e2e 动态保证：桩读 package.json，
# 版本徽章断言比较桩的输出，版本一变测试就红（update-settings.spec.ts）。
# 本脚本管的是「这套机制没被退化成写死」——静态结构，静态查。
#
# 允许的例外：构造「旧 → 新」相对关系的更新场景（update-settings.spec.ts 的
# 有新版本 describe）里 currentVersion/version 是测试数据，跟着发版走反而
# 没有意义。规则 1 只看 fixtures.ts（决定默认场景、也就是归档截图的那份）。
#
# 用法：
#   ./scripts/check-e2e-mock-version.sh                # 检查仓库根
#   ./scripts/check-e2e-mock-version.sh --root <dir>   # 检查指定目录（自测用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || { printf 'check-e2e-mock-version.sh: --root 需要一个目录参数\n' >&2; exit 2; }
      ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    *)
      printf 'check-e2e-mock-version.sh: 未知参数：%s\n用法：./scripts/check-e2e-mock-version.sh [--root <dir>]\n' "$1" >&2
      exit 2
      ;;
  esac
done
readonly ROOT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-e2e-mock-version.sh: 需要 python3 来解析清单与 e2e 源码\n' >&2
  exit 2
fi

python3 - "${ROOT}" <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
web = root / "web"
fixtures = web / "e2e" / "fixtures.ts"


def fail(message: str) -> None:
    print(f"  ✗ {message}")
    sys.exit(1)


if not fixtures.exists():
    fail(f"缺少 {fixtures}——e2e 场景工厂不在预期位置")

# 版本一致性的「源」：package.json 必须可读且带 version。
pkg_path = web / "package.json"
if not pkg_path.exists():
    fail(f"缺少 {pkg_path}")
try:
    version = json.loads(pkg_path.read_text(encoding="utf-8"))["version"]
except (json.JSONDecodeError, KeyError) as exc:
    fail(f"{pkg_path} 无法解析出 version：{exc}")
if not isinstance(version, str) or not version:
    fail(f"{pkg_path} 的 version 不是非空字符串")

text = fixtures.read_text(encoding="utf-8")

# 1. 场景工厂里 currentVersion 不许写字面量（写死的版本就是漂移的种子）。
hardcoded = re.compile(r"currentVersion\s*:\s*['\"]")
hit = hardcoded.search(text)
if hit:
    lineno = text.count("\n", 0, hit.start()) + 1
    fail(
        f"web/e2e/fixtures.ts:{lineno} 把 currentVersion 写成了字面量——"
        "版本必须来自 APP_VERSION（读 web/package.json），否则归档截图的版本徽章会停在旧版本"
    )

# 2. 「从 package.json 读版本」的机制必须在场：只禁字面量还不够，
#    把 APP_VERSION 本身写成常量，此刻不漂、下次发版照漂。
if "APP_VERSION" not in text:
    fail("web/e2e/fixtures.ts 里没有 APP_VERSION——场景工厂失去了版本的唯一来源")
if not re.search(r"readFileSync\([^)]*package\.json", text, re.DOTALL):
    fail(
        "web/e2e/fixtures.ts 的 APP_VERSION 没有从 package.json 读取——"
        "写成常量会在下次发版时重新漂移"
    )

# 3. e2e 源码里不许有「当前版本 v<数字>」的写死断言：它与动态桩脱节，
#    要等下一次发版才红。动态构造（`当前版本 v${APP_VERSION…}`）的 v 后面
#    跟的是 `${`，不会命中。
badge_pattern = re.compile(r"当前版本 v[0-9]")
for spec in sorted((web / "e2e").glob("*.ts")):
    for lineno, line in enumerate(spec.read_text(encoding="utf-8").splitlines(), 1):
        if badge_pattern.search(line):
            fail(f"{spec.relative_to(root)}:{lineno} 写死了版本徽章断言——用 APP_VERSION 构造期望值")

print(f"  ✓ e2e 版本桩与 web/package.json 同源（version {version}），无写死字面量")
PY
