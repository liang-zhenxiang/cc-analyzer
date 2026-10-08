#!/usr/bin/env bash
#
# lint.sh —— 本地统一校验入口
#
# 一条命令跑完 CI 里**本地能跑**的那些静态检查：actionlint、yamllint、shellcheck、
# bash -n、zizmor（工作流安全扫描）。提交 PR 之前跑一次，
# 可以把「推上去 → CI 红 → 改了再推」这个来回省掉。
#
# 用法：
#   ./scripts/lint.sh             # 跑全部检查（不接受参数）
#
# **不提供 --help**，并把任何参数当作错误拒掉：本脚本没有选项可讲，用法就是
# 「直接跑」，再印一段只写着「跑全部检查」的帮助是自说自话。真正要解决的是
# 「参数被静默吃掉」——`./scripts/lint.sh --help`（或任何拼错的选项）会一声不吭
# 跑完整套检查，看起来像是选项被接受了。拒绝比忽略诚实（见下面的参数检查）。
#
# 覆盖范围（别把它当成 CI 的替代品）：
#   - 覆盖：actionlint、yamllint、shellcheck、bash -n、PowerShell 编码、zizmor
#   - **不覆盖：前端测试/构建与 Rust 检查**（vitest / tsc / cargo fmt / clippy /
#     check）。它们是「测试与构建」不是静态检查，本地开发时本来就会跑，
#     命令见 CONTRIBUTING.md；CI 里各有独立 job
#   - **不覆盖：提交信息规范**。CI 的 commit-messages job 校验 PR 里的提交与
#     **PR 标题**，而标题在 PR 建立之前根本不存在——本地任何入口都验不了它。
#     本地全绿不等于 commit-messages 会绿，PR 标题仍需自己按规范写
#     （可用 ./scripts/check-commit-msg.sh --message "..." 先验一下标题格式）
#   - zizmor 用 docker 跑，镜像版本从 .github/workflows/ci.yml 抽出（与 CI 同源）；
#     本机没有 docker 时退化为本机 zizmor，版本未必与 CI 对齐
#
# 缺失的工具会被跳过并提示安装方式，不会让整个检查中断；跳过项一律显式列出，
# 不会被算作通过。

set -euo pipefail

# 本脚本不接受参数。**显式拒绝**而不是静默忽略：静默忽略会让
# `./scripts/lint.sh --help`（或任何拼错的选项）看起来像是被接受了，
# 实际却跑了一遍完整检查。退出码 2 与其他脚本对未知参数的处置一致。
if [[ $# -gt 0 ]]; then
  printf 'lint.sh 不接受参数（收到：%s）。用法：./scripts/lint.sh\n' "$1" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly PROJECT_ROOT

cd "$PROJECT_ROOT"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

PASSED=0
FAILED=0
SKIPPED=0
declare -a FAILED_NAMES=()
# 跑了、但**不是 CI 同源**的项。它们的「通过」与 CI 的通过可信度不同，而三计数
# 分不出来（都计在 PASSED 里）——所以单独记下来，在结尾一并列出。
declare -a NONSYNC_NOTES=()

# 执行一项检查。$1 是显示名，其余是命令。
run_check() {
  local name="$1"; shift
  printf '\n%s▶ %s%s\n' "$C_BOLD" "$name" "$C_RESET"
  printf '  %s$ %s%s\n' "$C_BLUE" "$*" "$C_RESET"

  if "$@"; then
    printf '  %s✓ 通过%s\n' "$C_GREEN" "$C_RESET"
    PASSED=$((PASSED + 1))
  else
    printf '  %s✗ 失败%s\n' "$C_RED" "$C_RESET"
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
}

# 跳过一项检查并说明原因，而不是让整个脚本崩掉。
# $1 显示名，$2 跳过原因（工具没装等），$3 可选的安装方式。
skip_check() {
  local name="$1" reason="$2" hint="${3:-}"
  printf '\n%s▶ %s%s\n' "$C_BOLD" "$name" "$C_RESET"
  printf '  %s⚠ 已跳过：%s%s\n' "$C_YELLOW" "$reason" "$C_RESET"
  if [[ -n "$hint" ]]; then
    printf '  %s  安装方式：%s%s\n' "$C_YELLOW" "$hint" "$C_RESET"
  fi
  SKIPPED=$((SKIPPED + 1))
}

# 记一次失败。用于「工具在、但这一项根本没法跑成」的情形——它和「工具不在」
# 是两回事，跳过会把问题藏起来（无法判定要单独成类，不能冒充正常）。
fail_check() {
  local name="$1" reason="$2" hint="${3:-}"
  printf '\n%s▶ %s%s\n' "$C_BOLD" "$name" "$C_RESET"
  printf '  %s✗ 失败：%s%s\n' "$C_RED" "$reason" "$C_RESET"
  if [[ -n "$hint" ]]; then
    printf '  %s  %s%s\n' "$C_RED" "$hint" "$C_RESET"
  fi
  FAILED=$((FAILED + 1))
  FAILED_NAMES+=("$name")
}

# 跟在某项检查后面交代它的边界（不影响计数）
note() {
  printf '  %sⓘ %s%s\n' "$C_BLUE" "$1" "$C_RESET"
}

printf '%s' "$C_BOLD"
cat <<'BANNER'
╭──────────────────────────────────────────────╮
│  CC Analyzer · 本地静态检查                  │
╰──────────────────────────────────────────────╯
BANNER
printf '%s' "$C_RESET"

# ---------------------------------------------------------------------------
# 1. actionlint —— 工作流语法与常见陷阱
#    它同时会调用 shellcheck 检查 run: 里的 Shell 片段
#
#    **显式传工作流文件列表，不裸跑。** 裸跑时 actionlint 要靠 .git 定位项目根，
#    而在不含 .git 的目录（典型场景：GitHub 的 source tarball 解压出来）里会直接
#    报「no project was found in any parent directories of …」——使用者什么都没改，
#    第一项就红。显式给文件则不必依赖 git，两种目录下都真跑。
#
#    这里只收 .github/workflows/ 下的 yml/yaml；dependabot.yml、labeler.yml
#    （.github/ 下那个）与 ISSUE_TEMPLATE/*.yml 都不是工作流，喂给 actionlint
#    会报「"jobs" section is missing in workflow」。yamllint 的目标集比这里大，
#    两个目标集不同，别合并。
#
#    目标文件集与规则集都同 CI 的 `./actionlint -color` 一致（CI 那边不传文件，
#    靠项目根自动发现同一批文件）：本地过要真的等于 CI 过。
# ---------------------------------------------------------------------------
WORKFLOW_TARGETS=()
while IFS= read -r f; do
  WORKFLOW_TARGETS+=("$f")
done < <(find .github/workflows -name '*.yml' -o -name '*.yaml' 2>/dev/null | sort)

if command -v actionlint >/dev/null 2>&1; then
  if [[ ${#WORKFLOW_TARGETS[@]} -gt 0 ]]; then
    run_check "actionlint（工作流静态检查）" actionlint -color "${WORKFLOW_TARGETS[@]}"
  else
    # 列表为空意味着这一项根本没跑成。不能悄悄放过：它会和「检查通过」长得一样，
    # 而使用者以为 CI 里那一项已经在本地说过了。
    fail_check "actionlint（工作流静态检查）" "没有找到任何工作流文件（.github/workflows/*.yml）" \
      "actionlint 拿不到文件就不会检查任何东西——这一项此时与跳过无异，但读者会以为它跑过了。"
  fi
else
  skip_check "actionlint（工作流静态检查）" "未安装对应工具" \
    "brew install actionlint  或  go install github.com/rhysd/actionlint/cmd/actionlint@latest"
fi

# ---------------------------------------------------------------------------
# 2. yamllint —— YAML 风格（.github/ 下全部 yml/yaml，含模板与配置）
# ---------------------------------------------------------------------------
YAML_TARGETS=()
while IFS= read -r f; do
  YAML_TARGETS+=("$f")
done < <(find .github -name '*.yml' -o -name '*.yaml' 2>/dev/null | sort)

if command -v yamllint >/dev/null 2>&1; then
  if [[ ${#YAML_TARGETS[@]} -gt 0 ]]; then
    run_check "yamllint（YAML 风格）" yamllint -c .yamllint "${YAML_TARGETS[@]}"
  else
    fail_check "yamllint（YAML 风格）" "没有找到任何 YAML 文件（.github/**/*.yml）" \
      "目标集为空时这项检查什么也没做，不能算通过。"
  fi
else
  skip_check "yamllint（YAML 风格）" "未安装对应工具" "brew install yamllint  或  pipx install yamllint"
fi

# ---------------------------------------------------------------------------
# 3. shellcheck —— Shell 脚本（含 lint.sh 自身）
# ---------------------------------------------------------------------------
SH_TARGETS=()
while IFS= read -r f; do
  SH_TARGETS+=("$f")
done < <(find scripts -name '*.sh' 2>/dev/null | sort)

if command -v shellcheck >/dev/null 2>&1; then
  if [[ ${#SH_TARGETS[@]} -gt 0 ]]; then
    run_check "shellcheck（Shell 脚本）" shellcheck -x "${SH_TARGETS[@]}"
  else
    fail_check "shellcheck（Shell 脚本）" "没有找到任何 Shell 脚本（scripts/*.sh）" \
      "目标集为空时这项检查什么也没做，不能算通过。"
  fi
else
  skip_check "shellcheck（Shell 脚本）" "未安装对应工具" "brew install shellcheck"
fi

# ---------------------------------------------------------------------------
# 4. bash 语法检查 —— 不依赖任何外部工具，永远会跑
# ---------------------------------------------------------------------------
if [[ ${#SH_TARGETS[@]} -gt 0 ]]; then
  for f in "${SH_TARGETS[@]}"; do
    run_check "bash -n（${f}）" bash -n "$f"
  done
fi

# ---------------------------------------------------------------------------
# 5. PowerShell 脚本编码 —— 含非 ASCII 字符时必须带 UTF-8 BOM
#
#    Windows PowerShell 5.1 在没有 BOM 时按系统 ANSI 代码页读取脚本文件，
#    中文注释会被误解码，进而报出 "Missing closing '}' in statement block"
#    这类解析错误。它**只在 Windows 上暴露**：本地与 macOS 构建都发现不了，
#    v0.2.1 首次发布就是这么挂在 Windows runner 上的。
#
#    纯 ASCII 的脚本没有这个风险，所以只检查含非 ASCII 的文件。
# ---------------------------------------------------------------------------
PS_TARGETS=()
while IFS= read -r f; do
  PS_TARGETS+=("$f")
done < <(find scripts -name '*.ps1' 2>/dev/null | sort)

# C locale 下删掉 ASCII 可打印字符与空白，仍有剩余即为非 ASCII 字节
has_non_ascii() {
  [[ "$(LC_ALL=C tr -d '[:print:][:space:]' < "$1" | wc -c | tr -d ' ')" -gt 0 ]]
}
has_utf8_bom() {
  [[ "$(head -c 3 "$1" | od -An -tx1 | tr -d ' \n')" == "efbbbf" ]]
}
check_ps_bom() {
  local f
  for f in "${PS_TARGETS[@]}"; do
    if has_non_ascii "$f" && ! has_utf8_bom "$f"; then
      printf '  %s✗ %s 含非 ASCII 字符但缺少 UTF-8 BOM%s\n' "$C_RED" "$f" "$C_RESET"
      return 1
    fi
  done
  return 0
}

if [[ ${#PS_TARGETS[@]} -gt 0 ]]; then
  run_check "PowerShell 编码（UTF-8 BOM）" check_ps_bom
fi

# ---------------------------------------------------------------------------
# 6. Python 语法 —— .claude/hooks 与 .trellis/scripts 是**每次会话自动执行**的代码
#
#    意义与 shellcheck 之于 scripts/ 相同，但对象更敏感：hook 一旦有语法错误，
#    每次会话的上下文注入会**静默失效**——它只往 stderr 打一行，很容易被当成
#    噪音略过，而使用者以为自己还受规范约束。
#
#    用 ast.parse 而不是 py_compile：后者会在源码旁写 __pycache__。
# ---------------------------------------------------------------------------
PY_TARGETS=()
while IFS= read -r f; do
  PY_TARGETS+=("$f")
done < <(find .claude/hooks .trellis/scripts -name '*.py' -not -path '*__pycache__*' 2>/dev/null | sort)

check_python_syntax() {
  local f
  for f in "${PY_TARGETS[@]}"; do
    if ! python3 -c \
      'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read(), sys.argv[1])' \
      "$f" 2>/dev/null; then
      printf '  %s✗ %s 语法错误：%s\n' "$C_RED" "$f" "$C_RESET"
      python3 -c \
        'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read(), sys.argv[1])' \
        "$f" 2>&1 | tail -2
      return 1
    fi
  done
  return 0
}

if ! command -v python3 >/dev/null 2>&1; then
  skip_check "Python 语法（自动执行的 hook 与脚本）" "未安装 python3" \
    "Trellis 的 hook 由 python3 驱动，没有它这些 hook 本来也跑不起来"
elif [[ ${#PY_TARGETS[@]} -gt 0 ]]; then
  run_check "Python 语法（自动执行的 hook 与脚本）" check_python_syntax
fi

# ---------------------------------------------------------------------------
# 7. JSON 合法性 —— .claude/settings.json 决定 hook 能否被加载
#
#    这份配置写坏了不会报错，只会让 hook 静默不生效。用 python3 -m json.tool
#    做纯解析校验（不格式化、不回写）。
# ---------------------------------------------------------------------------
JSON_TARGETS=()
while IFS= read -r f; do
  JSON_TARGETS+=("$f")
done < <(find .claude -maxdepth 1 -name '*.json' 2>/dev/null | sort)

check_json_valid() {
  local f
  for f in "${JSON_TARGETS[@]}"; do
    if ! python3 -m json.tool "$f" >/dev/null 2>&1; then
      printf '  %s✗ %s 不是合法 JSON：%s\n' "$C_RED" "$f" "$C_RESET"
      python3 -m json.tool "$f" 2>&1 | tail -2
      return 1
    fi
  done
  return 0
}

if [[ ${#JSON_TARGETS[@]} -gt 0 ]] && command -v python3 >/dev/null 2>&1; then
  run_check "JSON 合法性（Claude Code 配置）" check_json_valid
fi

# ---------------------------------------------------------------------------
# 8. Shell 变量展开紧邻多字节字符 —— macOS 自带 bash 3.2 会解析错
#
#    `"$ARCH（请用…）"` 这种写法，变量名后面紧跟一个全角字符，
#    bash 3.2 会把该多字节字符的首字节当成变量名的一部分，于是变量名变成
#    「ARCH + 半个汉字」——`set -u` 下直接报 `ARCH?: unbound variable`，
#    脚本当场死掉，而设计的错误提示一个字都打不出来。
#
#    bash 4+ 与 CI 的 bash 5 都不会犯这个错，所以它**只在 macOS 本地暴露**，
#    和 §5 的 PowerShell BOM 是同一类问题：本地/CI 的表现不一致。
#
#    修法一律是加花括号消歧：`"${ARCH}（…）"`。
# ---------------------------------------------------------------------------
check_shell_multibyte_expansion() {
  python3 - "${SH_TARGETS[@]}" <<'PY'
import pathlib, re, sys

pattern = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]")
hits = []
for name in sys.argv[1:]:
    for lineno, line in enumerate(pathlib.Path(name).read_text(encoding="utf-8").splitlines(), 1):
        # 整行注释跳过：注释不会被 bash 执行，而这里恰恰需要能写出反例来说明问题
        # （本检查自身的说明注释里就有一个）。
        if line.lstrip().startswith("#"):
            continue
        for match in pattern.finditer(line):
            hits.append(f"{name}:{lineno}  {match.group(0)}")
if hits:
    print("  变量展开后面紧跟非 ASCII 字符，bash 3.2 会解析错：")
    for hit in hits:
        print(f"    {hit}")
    print("  修法：写成 \"${VAR}（…）\"，用花括号把变量名界住。")
    sys.exit(1)
PY
}

if ! command -v python3 >/dev/null 2>&1; then
  skip_check "Shell 多字节解析（bash 3.2）" "未安装 python3" "brew install python3"
elif [[ ${#SH_TARGETS[@]} -gt 0 ]]; then
  run_check "Shell 多字节解析（bash 3.2）" check_shell_multibyte_expansion
fi

# ---------------------------------------------------------------------------
# 9. zizmor —— 工作流安全扫描（对应 CI 的 zizmor job）
#
#    镜像引用从 ci.yml 抽，不写第二份：写死会在 CI 升级时静默漂移，
#    而这一项的全部价值就是「本地过 = CI 过」。
#    没有 docker 时退化为本机 zizmor（版本未必与 CI 对齐，会提示）；
#    两者都没有才跳过。
# ---------------------------------------------------------------------------
ZIZMOR_NAME="zizmor（工作流安全扫描）"

# grep -o 找不到匹配时退出码是 1，set -e 下会让脚本当场退出，所以显式接住
ZIZMOR_REFS="$(grep -o 'ghcr\.io/zizmorcore/zizmor:[^[:space:]]*' .github/workflows/ci.yml 2>/dev/null)" || ZIZMOR_REFS=""
ZIZMOR_IMAGE="${ZIZMOR_REFS%%$'\n'*}"

if command -v docker >/dev/null 2>&1; then
  if [[ -z "$ZIZMOR_IMAGE" ]]; then
    fail_check "$ZIZMOR_NAME" "没能从 .github/workflows/ci.yml 里取到 zizmor 镜像版本" \
      "这一项靠「与 CI 同源」才有意义，取不到版本就不该随便挑一个来跑。"
  else
    # 与 CI 完全同一条命令，只是把容器里的 /repo 换成本地目录
    run_check "$ZIZMOR_NAME" docker run --rm -v "$PWD":/repo:ro \
      "$ZIZMOR_IMAGE" /repo --no-online-audits
  fi
elif command -v zizmor >/dev/null 2>&1; then
  local_zizmor_version="$(zizmor --version 2>/dev/null | head -n 1)"
  run_check "$ZIZMOR_NAME" zizmor . --no-online-audits
  # 这条结论的价值全在「与 CI 同源」上，而这条路径恰恰不同源——所以把两边的版本
  # 都摆出来，让读的人自己判断，而不是只说一句「可能有出入」就过去。
  note "本机没有 docker，退而用本机 zizmor（${local_zizmor_version}）；"
  note "CI 在 ci.yml 里 pin 的是 ${ZIZMOR_IMAGE:-未取到}；两者不一致时，本项的通过不等于 CI 的通过。"
  NONSYNC_NOTES+=("zizmor（本机 ${local_zizmor_version}，CI pin ${ZIZMOR_IMAGE:-未取到}）")
else
  skip_check "$ZIZMOR_NAME" "未安装 docker，本机也没有 zizmor" \
    "安装 Docker（CI 就是用 docker 跑 zizmor，本项依赖它），或 brew install zizmor"
fi

# ---------------------------------------------------------------------------
# 10. 视觉基线一致性 —— README 引用的截图必须存在且在截图套清单里
#
#     docs/screenshots/ 是 README 的门面，更新却全凭「人记得重出图」。上一轮
#     目录里混着相隔一天的两代截图（同一批里 usage-dark 还没有计费卡片），
#     而 README 引的正是这批图。check-screenshots.sh 用一份清单把「README 引用
#     断图」与「截图套缺视图」变成可判定的失败；这条把检查接进本地入口，
#     CI 侧由 screenshots-baseline job 跑同一脚本（外加它自己的自测）。
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  run_check "视觉基线一致性（截图清单 ↔ README 引用）" ./scripts/check-screenshots.sh
else
  skip_check "视觉基线一致性（截图清单 ↔ README 引用）" "未安装 python3" "brew install python3"
fi

# ---------------------------------------------------------------------------
# 11. 中英 README 结构一致性 —— 两版 README 的标题层级序列、docs/ 链接顺序与
#     相对链接可达性必须一致
#
#     仓库声明「两份 README 结构一致」，但在此之前没有任何检查。结构漂移是静默的：
#     一侧补了一节、另一侧忘了同步，两份都「渲染正常」，没有谁会去逐节比对。
#     check-readme-parity.sh 把它变成可判定的失败；CI 侧由 readme-parity job
#     跑同一脚本（外加它自己的自测）。
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  run_check "中英 README 结构一致性（标题层级 / docs 顺序 / 相对链接）" ./scripts/check-readme-parity.sh
else
  skip_check "中英 README 结构一致性（标题层级 / docs 顺序 / 相对链接）" "未安装 python3" "brew install python3"
fi

# ---------------------------------------------------------------------------
# 12. e2e 版本桩防漂移 —— 场景工厂的版本必须与 web/package.json 同源
#
#     e2e 桩里的版本号曾经写死成 "0.10.0"，之后两次发版都没人改它——每一版
#     归档截图的顶栏徽章都印着旧版本，截图在撒谎而没人发现。check-e2e-mock
#     -version.sh 断言「机制没被退化成写死」（禁 currentVersion 字面量、
#     要求 APP_VERSION 读 package.json、禁版本徽章断言写死版本号）。
#     「桩版本 = package.json 版本」的一致性本身由 e2e 动态保证
#     （update-settings.spec.ts 的徽章断言）。
# ---------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  run_check "e2e 版本桩防漂移（与 web/package.json 同源）" ./scripts/check-e2e-mock-version.sh
else
  skip_check "e2e 版本桩防漂移（与 web/package.json 同源）" "未安装 python3" "brew install python3"
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
printf '\n%s──────────────────────────────────────────────%s\n' "$C_BOLD" "$C_RESET"
printf '通过 %s%d%s · 失败 %s%d%s · 跳过 %s%d%s\n' \
  "$C_GREEN" "$PASSED" "$C_RESET" \
  "$C_RED" "$FAILED" "$C_RESET" \
  "$C_YELLOW" "$SKIPPED" "$C_RESET"

# 非 CI 同源的项单独列一遍。它们被计在「通过」里——三计数分不出来，而两者的
# 可信度不同。上面的 note 打在各自那一段，是否被读到取决于读者有没有翻到那里；
# 这里是人真正会看的位置。**不改三计数**：那是结构改动，与本条要解决的问题不成比例。
if [[ ${#NONSYNC_NOTES[@]} -gt 0 ]]; then
  printf '\n%s本次有 %d 项不是 CI 同源，其「通过」不等于 CI 的通过：%s\n' \
    "$C_YELLOW" "${#NONSYNC_NOTES[@]}" "$C_RESET"
  for _n in "${NONSYNC_NOTES[@]}"; do
    printf '  • %s\n' "$_n"
  done
fi

if [[ "$FAILED" -gt 0 ]]; then
  printf '\n%s以下检查未通过：%s\n' "$C_RED" "$C_RESET"
  for n in "${FAILED_NAMES[@]}"; do
    printf '  • %s\n' "$n"
  done
  printf '\n%s提示：%s大部分问题根据报错信息即可直接定位。\n' "$C_YELLOW" "$C_RESET"
  printf '      YAML 缩进问题可参考 .editorconfig（统一 2 空格）。\n'
  exit 1
fi

printf '\n%s✓ 以上检查全部通过。%s\n' "$C_GREEN" "$C_RESET"
printf '%s  注意：提交信息规范不在其中——CI 的 commit-messages job 校验 PR 标题，%s\n' "$C_YELLOW" "$C_RESET"
printf '        而标题在 PR 建立之前不存在，本地无从验证。PR 标题请按规范写。\n'
