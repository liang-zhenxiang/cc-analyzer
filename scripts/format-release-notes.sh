#!/usr/bin/env bash
#
# format-release-notes.sh —— 把 GitHub 原生的英文变更清单转成中文
#
# 发布说明由三段拼装：CHANGELOG 手写段 + GitHub 原生变更清单 + 可选 AI 摘要。
# 其中变更清单由 `releases/generate-notes` 生成，**模板串是写死的英文**：
#
#   ## What's Changed
#   ### <分类标题>                     ← 中文由 .github/release.yml 提供
#   * feat(web): … by @user in https://github.com/<owner>/<repo>/pull/1
#
#   ## New Contributors
#   * @user made their first contribution in https://github.com/…/pull/1
#
#   **Full Changelog**: https://github.com/…/compare/v1.0.0...v1.1.0
#
# 分类标题（`###` 那一层）在 `.github/release.yml` 里配置成中文，本脚本**不猜**；
# 它只负责那些**配置管不到**的固定模板串——`What's Changed` 这四个词是 GitHub
# 模板里的常量，没有任何配置项能改它们。
#
# 它同时处理 **CHANGELOG 手写段**。发布说明是把 CHANGELOG 中该版本的段落
# **原样**拼进去的（`release.yml` 的组装步骤），所以那一段里的英文也会进发布页：
#
#   ### Added / Changed / Deprecated / Removed / Fixed / Security
#
# 这六个分类标题是 Keep a Changelog 的固定英文，`AGENTS.md` 规定分类固定为它们、
# 不许自创——**在 CHANGELOG.md 里不改**（它是给协作者看的标准格式），拼进发布
# 说明前由本脚本转成中文。段落正文该不该是中文由人决定（见
# .trellis/spec/guides/release-notes.md 条款二）。
#
# 用法：
#   ./scripts/format-release-notes.sh pr-list.md > 中文清单.md
#   cat pr-list.md | ./scripts/format-release-notes.sh
#   ./scripts/format-release-notes.sh --check release-notes.md   # 只检查，不转换
#
# `--check` 是给发布工作流的兜底告警用的：检查一份**已经组装好的**发布说明里
# 还有没有英文模板串（分类标题配错、CHANGELOG 段落还是英文、规则被删都会命中）。
# 检测式只写在下面这一处——工作流里另抄一份正则的话，抄的那份不会跟着改。
#
# 退出码：
#   0  转换完成。**空输入、缺段同样是 0**——三段式发布说明各自的降级是既有设计，
#      不能因为拿不到 PR 清单就把整次发布卡死（见 docs/MAINTAINER_GUIDE.md）；
#      `--check` 时表示没查到英文模板串
#   1  `--check` 查到了英文模板串（命中的行打印在 stdout）
#   2  参数错误，或指定的输入文件不存在。这与「内容缺失」是两回事：那是调用方的
#      拼写/路径错误，静默当成空输入会把工作流里的 bug 伪装成「这次没有 PR」
#
# 幂等：输出再喂回来一次结果不变。这不是形式主义——tag 被重复推送会触发第二次
# 发布工作流，不幂等的转换会把已经中文化的说明再改一遍。
#
# 自测：./scripts/format-release-notes-test.sh（夹具在 scripts/tests/fixtures/release-notes/）

set -euo pipefail

usage() {
  cat <<'EOF'
format-release-notes.sh —— 把 GitHub 原生的英文变更清单转成中文

用法：
  ./scripts/format-release-notes.sh <文件>      # 转换文件，结果写到 stdout
  ... | ./scripts/format-release-notes.sh       # 从 stdin 读
  ./scripts/format-release-notes.sh --check <文件>
                                                # 只检查有没有英文模板串，
                                                # 有则打印命中行并以 1 退出
  -h, --help                                    # 显示帮助

转换的内容：
  ## What's Changed        → ## 变更清单
  ## New Contributors      → ## 新贡献者
  **Full Changelog**: URL  → **完整变更记录**：URL
  * 描述 by @user in URL   → * 描述（@user 提交于 URL）
  * @user made their first contribution in URL
                           → * @user 的首次贡献：URL

CHANGELOG 手写段的固定分类标题：
  ### Added / Changed / Deprecated / Removed / Fixed / Security
                           → ### 新增 / 变更 / 弃用 / 移除 / 修复 / 安全

PR 清单的分类标题（### 那一层）由 .github/release.yml 提供，本脚本不处理。
空输入、缺段都输出对应内容并以 0 退出：发布说明必须能降级，不能阻断发布。
EOF
}

INPUT=""
CHECK_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --check) CHECK_ONLY=1; shift ;;
    -*)
      printf '未知参数：%s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      # 显式拒绝第二个位置参数，而不是静默忽略：`script a.md b.md` 只转换 a
      # 却一声不吭，调用方会以为 b 也处理过了。
      if [[ -n "$INPUT" ]]; then
        printf '只接受一个输入文件，多余参数：%s\n\n' "$1" >&2
        usage >&2
        exit 2
      fi
      INPUT="$1"
      shift
      ;;
  esac
done

if [[ -n "$INPUT" ]] && [[ ! -f "$INPUT" ]]; then
  printf '输入文件不存在：%s\n' "$INPUT" >&2
  exit 2
fi

# 没有输入文件又没接管道时，裸跑会挂在等待 stdin 上——那时终端上什么提示都没有，
# 看起来像卡死。拒绝比沉默诚实。
if [[ -z "$INPUT" ]] && [[ -t 0 ]]; then
  printf '没有输入：请给出文件路径，或用管道喂入内容。\n\n' >&2
  usage >&2
  exit 2
fi

if [[ -n "$INPUT" ]]; then
  SOURCE="$INPUT"
else
  SOURCE="/dev/stdin"
fi
readonly SOURCE

# 「这里还有英文模板串」的检测式。**只有这一份**：--check 用它，自测也用它，
# 工作流不再另抄（抄的那份不会跟着改）。三段分别对应 GitHub 模板的两个固定
# 标题 + 对比链接、贡献者句式、以及 CHANGELOG 的六个固定分类标题。
readonly EN_TEMPLATE_RE="What's Changed|New Contributors|Full Changelog|made their first contribution in| by @[^[:space:]]+ in http|^### (Added|Changed|Deprecated|Removed|Fixed|Security)[[:space:]]*$"

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  # 命中行原样打出来：只说「有英文」而不指出是哪几行，读日志的人还得自己找。
  # `|| true` 是必要的——grep 找不到时退出码 1，`set -e` 会当场中止。
  hits="$(grep -nE "$EN_TEMPLATE_RE" "$SOURCE" || true)"
  if [[ -n "$hits" ]]; then
    printf '%s\n' "$hits"
    exit 1
  fi
  exit 0
fi

# 逐行替换，只认整行/行尾的固定句式，不做模糊匹配：
#   - 标题行要求整行匹配（含结尾），避免误伤正文里恰好提到这些词的段落
#   - 贡献者行要求行尾匹配，避免误伤标题里本来就写着 by … in … 的 PR
# 顺序有意义：先处理更具体的「首次贡献」句式，再处理通用的 `by … in …`。
#
# **不要用 `https\?`**：那在 GNU sed 的 BRE 里是「可选」，macOS 自带的 BSD sed
# 却当成字面量，于是本机一条都匹配不上、CI 上却正常——又一个「本地过、CI 也过、
# 但结果不同」的坑。`https*` 是两边都认的写法，且同样匹配 http/https
# （实测见 scripts/format-release-notes-test.sh 的 typical 用例）。
transform() {
  # $1 是要转换的文件（stdin 走 /dev/stdin，理由见下面的调用处）
  sed \
    -e 's/^## What'\''s Changed[[:space:]]*$/## 变更清单/' \
    -e 's/^## New Contributors[[:space:]]*$/## 新贡献者/' \
    -e 's/^### Added[[:space:]]*$/### 新增/' \
    -e 's/^### Changed[[:space:]]*$/### 变更/' \
    -e 's/^### Deprecated[[:space:]]*$/### 弃用/' \
    -e 's/^### Removed[[:space:]]*$/### 移除/' \
    -e 's/^### Fixed[[:space:]]*$/### 修复/' \
    -e 's/^### Security[[:space:]]*$/### 安全/' \
    -e 's/^\*\*Full Changelog\*\*:[[:space:]]*/\*\*完整变更记录\*\*：/' \
    -e 's/^\* \(@[^[:space:]]*\) made their first contribution in \(https*:\/\/[^[:space:]]*\)[[:space:]]*$/* \1 的首次贡献：\2/' \
    -e 's/ by \(@[^[:space:]]*\) in \(https*:\/\/[^[:space:]]*\)[[:space:]]*$/（\1 提交于 \2）/' \
    "$1"
}

# sed 读空输入时输出为空并以 0 退出——降级路径不需要额外分支，
# 这正是想要的：没有内容就没有内容，不是错误。
#
# stdin 用 /dev/stdin 显式给路径，**不要写 `sed - file` 里的那个 `-`**：
# 只有 GNU sed 把 `-` 当作 stdin，macOS 自带的 BSD sed 会把它当成一个名叫 `-`
# 的文件，报 `sed: -: No such file or directory` 并以 1 退出——本机管道用法全挂，
# 而 Linux 上的 CI 一切正常。
transform "$SOURCE"
