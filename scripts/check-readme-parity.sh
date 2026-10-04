#!/usr/bin/env bash
#
# check-readme-parity.sh —— 中英两版 README 的结构一致性检查
#
# 为什么需要它：仓库声明「两份 README 结构一致」（README.zh-CN.md 顶部就这么写），
# 但在此之前**没有任何检查**。结构漂移是静默的——一侧补了一节、另一侧忘了同步，
# 读英文的人看到的能力与读中文的人看到的不一样，而两份都「渲染正常」，
# 没有谁会去逐节比对。上一轮 README 门面补全（v0.6–v0.10 的能力）就是靠人记着
# 两边一起改；这种「靠人记得」的约定，迟早会漏。
#
# 断言两件事，任何一件不成立就红：
#   1. README.md 与 README.zh-CN.md 的**标题层级序列**完全一致（层级 + 顺序）。
#      两版的标题文字必然不同（一份中文一份英文），所以能比的是层级序列——
#      它能抓住「一侧多了一节 / 少了一节 / 嵌套层级变了」。实现上**跳过围栏
#      代码块**：README 的 bash 示例里有 `# macOS Apple Silicon` 这类注释行，
#      朴素地 grep '^#' 会把它们当成标题（本项目踩过同类坑）。
#   2. 两版 README 里 **`docs/` 链接的出现顺序**一致。这是对第 1 条的补充：
#      标题层级序列看不出**同级章节的纯重排**，而「文档索引」这种同级表格一旦
#      两侧顺序不同，往往意味着某一侧被单独改过。relative 链接两版各链自己语言
#      的那份（CONTRIBUTING.md / CONTRIBUTING.zh-CN.md）是预期差异，所以只比
#      两侧都必然指向同一份的 `docs/` 前缀链接。
#   3. 两版 README 里**每一处相对链接都能落到磁盘上**——README 引用的文档不存在
#      时立刻红，而不是等读者点出一个 404。
#
# 边界（诚实说明）：本脚本**看不出同级章节的纯重排**（在 `docs/` 之外、且两节都
# 不含 docs 链接时），也看不出「同一节里换了措辞」——这些判断需要语言理解，
# 不是正则该干的事。这一条由 PR 里的人工逐节对照兜底。
#
# 用法：
#   ./scripts/check-readme-parity.sh                # 检查仓库根
#   ./scripts/check-readme-parity.sh --root <dir>   # 检查指定目录（自测用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || { printf 'check-readme-parity.sh: --root 需要一个目录参数\n' >&2; exit 2; }
      ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    *)
      printf 'check-readme-parity.sh: 未知参数：%s\n用法：./scripts/check-readme-parity.sh [--root <dir>]\n' "$1" >&2
      exit 2
      ;;
  esac
done
readonly ROOT

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-readme-parity.sh: 需要 python3 来解析两版 README\n' >&2
  exit 2
fi

python3 - "${ROOT}" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
READMES = ["README.md", "README.zh-CN.md"]

# 标题：行首 1~6 个 #，后接空白与至少一个非空白字符。
HEADING = re.compile(r"^(#{1,6})\s+\S")
# 链接（含图片）：取 ](...) 里的目标；同一行可能有多处，findall 全收。
LINK = re.compile(r"\]\(([^)\s]+)")
# 围栏代码块：行首（允许缩进）的 ``` 或 ~~~
FENCE = re.compile(r"^\s*(```|~~~)")


def fail(message):
    print(f"  ✗ {message}")
    sys.exit(1)


def clean_target(target):
    """去掉锚点 / 查询串与 ./ 前缀，得到仓库内相对路径。"""
    target = target.split("#", 1)[0].split("?", 1)[0]
    if target.startswith("./"):
        target = target[2:]
    return target


def is_relative(target):
    if target.startswith(("http://", "https://", "mailto:", "#", "/")):
        return False
    return clean_target(target) != ""


def scan(path):
    """返回 (标题层级序列, 全部相对链接目标, docs/ 链接目标的有序序列)。"""
    levels = []
    links = []
    in_fence = False
    fence_marker = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m = FENCE.match(line)
        if m:
            marker = m.group(1)
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = None
            # 围栏那一行本身既不是标题也不含我们要的链接
            continue
        if in_fence:
            continue
        h = HEADING.match(line)
        if h:
            levels.append(len(h.group(1)))
        for target in LINK.findall(line):
            if is_relative(target):
                links.append(clean_target(target))
    return levels, links


paths = {}
for name in READMES:
    path = root / name
    if not path.exists():
        fail(f"找不到 {name}——两版 README 必须同时存在才能比对")
    paths[name] = path

levels = {}
links = {}
docs_seq = {}
for name, path in paths.items():
    levels[name], links[name] = scan(path)
    docs_seq[name] = [t for t in links[name] if t.startswith("docs/")]

en, zh = READMES

# --- 断言 0：不能空比对（解析不出来时检查会「假通过」）---
for name in READMES:
    if not levels[name]:
        fail(f"{name} 里没有解析出任何标题——检查无从判断，先确认文件不是空的")

# --- 断言 1：标题层级序列一致 ---
if levels[en] != levels[zh]:
    fail(
        "两版 README 的标题层级序列不一致：\n"
        f"    {en}: {'-'.join(map(str, levels[en]))}\n"
        f"    {zh}: {'-'.join(map(str, levels[zh]))}\n"
        "  一侧多了一节 / 少了一节，或嵌套层级不同。两版标题文字必然不同，"
        "这里比的是层级与顺序。"
    )

# --- 断言 2：docs/ 链接出现顺序一致 ---
if docs_seq[en] != docs_seq[zh]:
    fail(
        "两版 README 里 docs/ 链接的出现顺序不一致（通常是文档索引被单独改过）：\n"
        f"    {en}: {' → '.join(docs_seq[en]) or '（无）'}\n"
        f"    {zh}: {' → '.join(docs_seq[zh]) or '（无）'}"
    )

# --- 断言 3：每一处相对链接都要能落到磁盘上 ---
for name in READMES:
    for target in links[name]:
        if not (root / target).exists():
            fail(f"{name} 引用了不存在的路径：{target}")

print(
    f"  ✓ 两版 README 结构一致：标题层级序列 {len(levels[en])} 节，"
    f"docs/ 链接 {len(docs_seq[en])} 条，"
    f"相对链接全部可解析（英文 {len(links[en])} 处 / 中文 {len(links[zh])} 处）"
)
PY
