#!/usr/bin/env bash
#
# gui-test-shutdown-test.sh —— gui-test.sh 的「中断清理」自测
#
# 为什么需要它：`gui-test.sh` 会**后台启动打包好的应用**，正常路径由 EXIT trap 里的
# `cleanup()` 收尾。但如果只挂 EXIT，脚本被 Ctrl-C（INT）或调用方 / agent 中断（TERM）
# 时不会走到清理，后台 app 会泄漏成 PPID=1 的孤儿实例（实测见过 6 个），累积污染后续
# 运行的环境与内存基线。本测试把「中断后一定收掉本轮 app」变成一条可判定的断言，而不是
# 「我手动试过」。
#
# 做法：真启动 `gui-test.sh`，`--app` 指向一个假产物——它的「可执行文件」写一行
# `CCA_GUI_CAPTURE`（过 feature 预检）后把自己的 PID 写进文件再 `exec` 成长睡眠。
# 测试给 gui-test.sh **本身**（不是进程组）发 TERM / INT，断言那个子进程确实被收掉：
# 子进程没收到信号，若还活着，就只能是 cleanup 收的。
#
# 清理只认本轮记录的 PID，**绝不** `pkill -f "CC Analyzer"` 宽匹配——使用者可能正从
# /Applications 开着同名应用（见 gui-test.sh 的 cleanup()）。
#
# 用法：./scripts/gui-test-shutdown-test.sh
# 退出码：0 两个用例都过；1 有用例失败。

set -euo pipefail

# 打开作业控制（-m）：否则 bash 会把后台作业的 SIGINT/SIGQUIT 设成**忽略**，被启动的
# gui-test.sh 就**无法** trap INT——那样本测试的 Ctrl-C 用例是假阴性，而不是真的验证。
# 打开后后台作业各成独立进程组、INT 可捕获，才等价于「前台被 Ctrl-C」。
set -m

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly PROJECT_ROOT

# gui-test.sh 在启动应用**之前**要用 node 做夹具的时间平移；缺 node 就到不了「启动应用」，
# 本测试会以「假应用没启动」这种误导性的方式失败。先明确拒绝。
if ! command -v node >/dev/null 2>&1; then
  printf 'gui-test-shutdown-test.sh: 需要 node（gui-test.sh 启动应用前会用它）\n' >&2
  exit 2
fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_RESET=""
fi

PASSED=0
FAILED=0
ok()  { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; PASSED=$((PASSED + 1)); }
bad() { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"; FAILED=$((FAILED + 1)); }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cca-gui-shutdown.XXXXXX")"
readonly TMP

# 万一某个用例中途失败、子进程还活着，别把泄漏留给下一次运行。
LEAKED_PID=""
cleanup() {
  if [[ -n "$LEAKED_PID" ]]; then
    kill -9 "$LEAKED_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 造一个假 .app：可执行文件必须含 `CCA_GUI_CAPTURE`（gui-test.sh 的 feature 预检靠它），
# 启动后把 $$ 写进 pidfile 再 exec 成 sleep——PID 保持不变，便于断言它是否被收掉。
make_fake_app() {
  local app="$1" pidfile="$2"
  mkdir -p "${app}/Contents/MacOS"
  local bin="${app}/Contents/MacOS/cc-analyzer"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# feature 预检字面量：CCA_GUI_CAPTURE\n'
    printf 'echo "$$" > %q\n' "$pidfile"
    printf 'exec sleep 300\n'
  } >"$bin"
  chmod +x "$bin"
}

# run_case <用例名> <信号>
run_case() {
  local name="$1" sig="$2"
  local case_dir="${TMP}/${name}"
  local app="${case_dir}/Fake.app"
  local pidfile="${case_dir}/child.pid"
  mkdir -p "$case_dir"
  make_fake_app "$app" "$pidfile"

  # 真启动 gui-test.sh（不 --build：假产物已就位；这一步只为走到「启动应用」）。
  "$PROJECT_ROOT/scripts/gui-test.sh" --app "$app" >"${case_dir}/gui-test.log" 2>&1 &
  local gt_pid=$!

  # 等假「应用」起来并写出 PID。
  local started=0
  for _ in {1..100}; do
    [[ -s "$pidfile" ]] && { started=1; break; }
    sleep 0.1
  done
  if [[ "$started" != "1" ]]; then
    bad "${name}：假应用没启动，用例无效（gui-test.log 前几行见下）"
    sed -n '1,10p' "${case_dir}/gui-test.log" | sed 's/^/      /' || true
    kill -9 "$gt_pid" 2>/dev/null || true
    return 1
  fi
  local child
  child="$(cat "$pidfile")"
  LEAKED_PID="$child"

  if ! kill -0 "$child" 2>/dev/null; then
    bad "${name}：假应用刚启动就没了，用例无效"
    return 1
  fi

  # 只给 gui-test.sh 发信号，不发给进程组：子进程收不到，若事后还活着就只能是 cleanup 漏了。
  kill "-${sig}" "$gt_pid" 2>/dev/null || true

  # 看门狗兜底：万一下面 wait 卡住，10 秒后强杀，避免用例挂死。
  # `disown` 掉再 kill：开着作业控制（-m）时，未 disown 的后台作业被收掉会被 bash
  # 播报一行 "Terminated: 15 …"——非失败却像失败（gui-test.sh pitfall #10 同款）。
  ( sleep 10; kill -9 "$gt_pid" 2>/dev/null || true ) &
  local watchdog=$!
  disown "$watchdog" 2>/dev/null || true
  wait "$gt_pid" 2>/dev/null || true
  kill "$watchdog" 2>/dev/null || true

  # 断言子进程被收掉（cleanup 里是 sleep 1 + kill -9，留足余量）。
  local gone=0
  for _ in {1..100}; do
    if ! kill -0 "$child" 2>/dev/null; then gone=1; break; fi
    sleep 0.1
  done
  if [[ "$gone" == "1" ]]; then
    ok "${name}：gui-test.sh 收到 ${sig} 后，后台 app 进程（PID ${child}）被 cleanup 收掉"
    LEAKED_PID=""
    return 0
  fi
  bad "${name}：后台 app 进程（PID ${child}）在 ${sig} 后仍存活——泄漏未清理"
  kill -9 "$child" 2>/dev/null || true
  LEAKED_PID=""
  return 1
}

printf 'gui-test.sh 中断清理自测\n'
# 两个信号各跑一次；`|| true` 让某个用例失败后仍继续跑下一个并打印汇总。
run_case "SIGTERM" TERM || true
run_case "SIGINT" INT || true

printf '\n──────────────────────────────\n'
printf '通过 %s%d%s · 失败 %s%d%s\n' "$C_GREEN" "$PASSED" "$C_RESET" "$C_RED" "$FAILED" "$C_RESET"
if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
printf '%s✓ gui-test.sh 中断清理自测通过%s\n' "$C_GREEN" "$C_RESET"
