# 网络抖动与代理排查清单

> 思考型清单：GitHub 访问异常时按此排查。不是规范——每台开发机的网络环境不同，
> **没有代理的开发者跳过代理相关步骤即可**，不要把「走直连」当成普适结论。

## 症状（任一命中就该想到网络侧）

- `gh` 报 `Post "https://api.github.com/graphql": EOF`、`unexpected EOF`
- `git push/ls-remote` 报 `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`
- 命令「卡住很久然后超时」，或超时后被移入后台才完成
- CI 明明全绿，PR 却长时间 `BLOCKED`（这条多数是 GitHub 状态同步延迟，
  见 AGENTS.md「合并」节——先排除网络，再等 30~60 秒，别急着找绕过）

## 排查顺序

1. **先量化，别猜**：对两种通道各测几次，比较状态码与耗时：
   ```bash
   curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.github.com
   env -u http_proxy -u https_proxy -u all_proxy \
     curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.github.com
   ```
   判据看趋势不看单次：一通道 200 且亚秒、另一通道 403 或秒级抖动，答案就出来了。
   注意 `api.github.com` 根路径对未认证请求**本来就返回 403/404**，两通道要同条件对比，
   别拿一个 403 当结论——本次实录是「代理通道 403 + 1.5~5.4s」对「直连 200 + 0.3s」。
   **还要按主机分开测**：`api.github.com` 通不等于 `github.com` 通（2026-10-02 实录：
   api 与 codeload 直连 200/0.3s，github.com 直连 443 超时——`gh` 命令全好、
   `git push/pull` 全挂）。此时 git 单独走代理即可，不必全局切换：
   `git -c http.proxy=http://127.0.0.1:56134 pull ...`
2. **本机在用代理的话**（`env | grep -i proxy` 有输出）：代理进程可能挂了、
   出口 IP 可能被 GitHub 限流。临时切换某一通道再测：
   ```bash
   unproxy    # 或对单条命令：env -u http_proxy -u https_proxy -u all_proxy <命令>
   proxy      # 切回
   ```
   别名只在交互 shell 里存在；脚本/CI 中要么用 `env -u`，要么显式 `export`。
3. **代理环境下的易错点**：
   - Claude Code / 子 agent 的 Bash 各自独立初始化，`unproxy` 一次不会延续到下一条
     命令——对 git/gh 的网络命令逐条加 `env -u …` 前缀，或在命令内联完成。
   - `launchctl setenv` 只影响之后启动的 GUI 进程，救不了已在跑的终端会话。

## 踩过的实录（2026-10-01，开发者本机）

代理开启时 gh/git 全天 `EOF` / `SSL_ERROR_SYSCALL`、push 3 分钟超时；实测代理出口
被 GitHub 限流（403、1.5~5.4s），直连 200 且 0.3s。对网络命令改走直连后推送秒成。
**这只说明「那天那个代理出口」不行，不说明代理本身不该用**——出口换掉后结论可能
反过来，所以永远回到第 1 步重新量化。

## 相关既有规则（网络抖动的二次伤害）

- tag 推送「显示失败、远端已成功」时重推会触发两次发布——推 tag 前先
  `git ls-remote --tags origin vX.Y.Z` 确认（AGENTS.md「发布」节）。
- 分支 push 失败可直接重试；先 `git ls-remote` 区分「真没推上去」与「报了错其实成了」。
