#!/usr/bin/env bash
#
# install-linux-deps.sh —— 在 Linux CI runner 上安装 Tauri 编译所需的系统库。
#
# 为什么要有这个脚本：`apt-get update/install` 的失败几乎都发生在**下载**阶段
# （镜像抖动、连接卡死），而单个 `Acquire::Retries` 只在单次请求内重试——整轮
# 卡住时它救不回来。2026-11 连续两次 PR 的 Rust 作业都死在「安装 Tauri Linux
# 依赖」的 15 分钟 step 超时上（#316、#323），与代码无关。
#
# 这里的做法是**外层整轮重试**：把 update + install 当成一个原子步骤，失败后
# 等一会儿从头再来；配合更短的连接超时（默认 15s）与关闭 HTTP pipelining，
# 卡住的连接会更快被判死并换一条。
#
# 可调环境变量（测试与特殊 runner 用）：
#   APT_ATTEMPTS        整轮尝试次数（默认 3）
#   APT_RETRY_SLEEP     两次尝试之间的等待秒数（默认 15）
#   APT_HTTP_TIMEOUT    单次 HTTP 连接超时秒数（默认 15）
#   APT_ARCHIVES_DIR    非空时把 .deb 下载物落到该目录（供 actions/cache 打包）
#   SUDO                置空可跳过 sudo（脚本自测用；默认 sudo）
#   APT_GET             apt 可执行文件名（自测注入假命令用；默认 apt-get）
#   PACKAGES_FILE       包清单路径（默认 .github/ci-tauri-apt-packages.txt）
#
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"

packages_file="${PACKAGES_FILE:-${repo_root}/.github/ci-tauri-apt-packages.txt}"
attempts="${APT_ATTEMPTS:-3}"
retry_sleep="${APT_RETRY_SLEEP:-15}"
http_timeout="${APT_HTTP_TIMEOUT:-15}"
archives_dir="${APT_ARCHIVES_DIR:-}"
apt_get="${APT_GET:-apt-get}"

# sudo 用数组表示：置空时展开成零个词，而不是一个空参数。
sudo_cmd=()
if [[ -n "${SUDO-sudo}" ]]; then
  sudo_cmd=("${SUDO-sudo}")
fi

# bash 3.2（macOS 自带）在 `set -u` 下展开空数组会报 unbound variable，
# 所以统一走这个函数，而不是到处写 `"${sudo_cmd[@]}"`。
as_root() {
  if (( ${#sudo_cmd[@]} > 0 )); then
    "${sudo_cmd[@]}" "$@"
  else
    "$@"
  fi
}

if [[ ! -f "$packages_file" ]]; then
  echo "::error::找不到包清单：${packages_file}" >&2
  exit 1
fi

# 注释行不算包名；清单为空会让 install 变成「没有参数」，必须当场失败。
packages="$(grep -v '^[[:space:]]*#' "$packages_file" | tr '\n' ' ')"
if [[ -z "${packages//[[:space:]]/}" ]]; then
  echo "::error::包清单是空的：${packages_file}" >&2
  exit 1
fi

apt_opts=(
  -o Acquire::ForceIPv4=true
  -o Acquire::Retries=2
  -o "Acquire::http::Timeout=${http_timeout}"
  -o "Acquire::https::Timeout=${http_timeout}"
  # pipelining 在部分镜像上会把连接卡在半开状态，直接关掉更稳。
  -o Acquire::http::Pipeline-Depth=0
)

if [[ -n "$archives_dir" ]]; then
  mkdir -p "$archives_dir"
  # apt 的下载沙箱用户 `_apt` 要能写；否则每次安装都留一条
  # 「Download is performed unsandboxed as root … Permission denied」的告警。
  chmod -R 0777 "$archives_dir"
  # Playwright 之类的外部调用传不进 -o，写一份全局配置让它们也落到同一个缓存。
  printf 'Dir::Cache::archives "%s";\n' "$archives_dir" |
    as_root tee /etc/apt/apt.conf.d/99-ci-apt-cache >/dev/null
  apt_opts+=(-o "Dir::Cache::archives=${archives_dir}")
fi

attempt=1
while ((attempt <= attempts)); do
  echo "::group::apt 安装尝试 ${attempt}/${attempts}"
  # shellcheck disable=SC2086  # 包名需要按空白拆成多个参数
  if as_root "$apt_get" "${apt_opts[@]}" update &&
    as_root "$apt_get" "${apt_opts[@]}" install -y $packages; then
    # 属主交还给 runner：缓存动作以 runner 身份打包，root 拥有的文件会让保存
    # 失败，而失败**不会**让 job 变红（只在日志里留一句），缓存永远建不起来。
    if [[ -n "$archives_dir" ]]; then
      as_root chown -R "$(id -u)":"$(id -g)" "$archives_dir"
    fi
    echo "::endgroup::"
    echo "Linux 依赖安装完成（第 ${attempt} 次尝试）"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::第 ${attempt} 次 apt 安装失败（镜像不可用或连接超时）" >&2
  attempt=$((attempt + 1))
  if ((attempt <= attempts)); then
    sleep "$retry_sleep"
  fi
done

echo "::error::apt 安装连续失败 ${attempts} 次，镜像持续不可用" >&2
exit 1
