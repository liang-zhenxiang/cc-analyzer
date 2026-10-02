#!/usr/bin/env bash
#
# make-updater-json.sh —— 生成 tauri-plugin-updater 消费的 latest-*.json
#
# 用法：
#   make-updater-json.sh <版本号> <tag> <说明文件> <产物目录>
#
# 扫描产物目录里的 *.sig，按文件名推断平台键与下载 URL（URL 指向
# releases/download/<tag>/<资产名>，资产名必须是规范化后的名字——
# 调用方负责先做空格→连字符的重命名，和 release.yml 的规范步骤一致）。
#
# 平台映射（与 tauri-plugin-updater 的 target 键一致）：
#   *_aarch64.app.tar.gz → darwin-aarch64
#   *_x64.app.tar.gz     → darwin-x86_64
#   *_x64-setup.exe      → windows-x86_64
#
# 为什么是脚本而不是 workflow 里一段内联 bash：这份映射与产物命名规范
# 是一对契约，beta 与稳定两条发布路径都要用，内联两份必然漂移。
#
# 退出码：0 正常；2 目录里一个 .sig 都没有（多半是构建没产出更新包）。

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "用法：$0 <版本号> <tag> <说明文件> <产物目录>" >&2
  exit 1
fi

version="$1"
tag="$2"
notes_file="$3"
dir="$4"

repo="${GITHUB_REPOSITORY:-liang-zhenxiang/cc-analyzer}"
base_url="https://github.com/${repo}/releases/download/${tag}"

# sig 文件名 → 平台键。签名文件与更新包同名（仅多 .sig），所以包名 =
# 去掉 .sig 的文件名；URL 用包名。
# macOS 自带 bash 3.2，没有 mapfile——用数组下标循环收集（项目 bash 硬规则）。
sigs=()
while IFS= read -r sig; do
  sigs+=("$sig")
done < <(find "$dir" -name '*.sig' -type f | sort)
if [[ ${#sigs[@]} -eq 0 ]]; then
  echo "错误：${dir} 下没有任何 .sig 文件——构建没有产出更新包？" >&2
  exit 2
fi

# pub_date：有真实时间用真实时间（CI 注入），本地测试给个固定值。
pub_date="${UPDATE_PUB_DATE:-2026-01-01T00:00:00Z}"

platform_json="{}"
for sig in "${sigs[@]}"; do
  name="$(basename "$sig")"
  package="${name%.sig}"
  case "$package" in
    *_aarch64.app.tar.gz) platform="darwin-aarch64" ;;
    *_x64.app.tar.gz)     platform="darwin-x86_64" ;;
    *_x64-setup.exe)      platform="windows-x86_64" ;;
    *)
      echo "::warning::无法识别平台，跳过：${package}" >&2
      continue
      ;;
  esac
  signature="$(cat "$sig")"
  platform_json="$(printf '%s' "$platform_json" | jq \
    --arg platform "$platform" \
    --arg signature "$signature" \
    --arg url "${base_url}/${package}" \
    '. + {($platform): {signature: $signature, url: $url}}')"
done

# 说明：发布说明太长没有意义（updater 只弹一段），截前 600 字符。
notes="$(head -c 600 "$notes_file" 2>/dev/null || true)"

jq -n \
  --arg version "$version" \
  --arg notes "$notes" \
  --arg pub_date "$pub_date" \
  --argjson platforms "$platform_json" \
  '{version: $version, notes: $notes, pub_date: $pub_date, platforms: $platforms}'
