# 修复 claude CLI 探测与调用

## Goal

用户点「生成整会话分析」报：

> 未找到 claude CLI：应用无法启动 `claude`（从 Finder/Dock 打开时 PATH 会收窄）。
> 常见安装位置也没有找到它，请先安装 Claude Code CLI…

但用户**已经装了** Claude Code CLI。本机实测：

```
$ which claude
/Users/liangyuxiang/.nvm/versions/node/v24.13.0/bin/claude
```

## 根因（已核实）

1. **候选路径表漏了版本管理器**。`web/src/features/sessions/cliProbe.ts` 的
   `candidateClaudePaths()` 只覆盖 `~/.claude/local`、`~/.local/bin`、
   `/opt/homebrew/bin`、`/usr/local/bin`、`~/.bun/bin`、`~/.npm-global/bin`。
   nvm / volta / fnm / asdf / mise / pnpm / yarn 装的 `claude` 一个都不在表里,
   所以 `installedCandidates()` 返回空，走进「常见安装位置也没有找到它」分支。
2. **就算找到了也没用**。`cliProbe` 只把找到的路径拼进**错误文案**；
   `report.ts` 的 `generateReport()` 里调用侧**硬编码** `"claude"`：

   ```ts
   const result = await bridges.proc.runLines("claude", args, ...)
   ```

   PATH 里没有就照样启动失败。**只改文案不算修好**。

## Requirements

1. 候选路径扩到覆盖常见 Node 版本管理器与包管理器安装位置
   （至少：nvm、volta、fnm、asdf、mise、pnpm、yarn、nodenv，以及
   `~/.local/share/mise/shims` 这类 shim 目录）。
2. **探测结果要能用于执行**：`probeClaudeCli` 除了 `status` / `hasStreamJson`，
   还要给出**可执行命令**（绝对路径，或确认 PATH 可用时的 `claude`）。
   `generateReport()` 必须用这个解析出来的命令去 `runLines`，不再硬编码。
3. 命令解析结果要在一次会话内复用（同一次分析里 probe 与 run 必须指同一条路径），
   避免「探测成功但执行用了另一条」的错位。
4. 错误文案要**如实**：只有真的哪儿都找不到时才说「没找到」；
   找到了但不可执行（权限、损坏）要说清是哪种。
5. 不改 Tauri 侧的 `run_lines` 契约（参数签名已冻结给前端）。

## Acceptance Criteria

- [ ] 单元测试：给定 home 目录，`candidateClaudePaths()` 覆盖 nvm / volta /
      fnm / asdf / mise / pnpm / yarn 的安装位置（夹具驱动）
- [ ] 单元测试：`probeClaudeCli` 在**PATH 不可用但候选路径命中**时，
      返回的解析命令 = 命中的绝对路径（不是字面量 `claude`）
- [ ] 单元测试：`generateReport()` 用解析出来的命令调用 `runLines`
      （断言 mock 收到的 `cmd` 是绝对路径），且 `--help` 的 `hasStreamJson`
      决定参数集这条既有行为不回退
- [ ] 单元测试：全部候选都不命中时，错误文案明确且**不泄漏绝对路径**以外的
      隐私信息（沿用既有「错误文案不带用户路径」的约定，若与之冲突以既有约定为准）
- [ ] Windows 分支的候选路径不被破坏；两边都有测试
- [ ] `npm --prefix web test` 全绿，`./scripts/lint.sh` 全绿

## Notes

- 上一条既有约定：Rust 侧 `io_error` 对用户只输出「文件或目录不存在」,
  不带原始路径。前端错误文案里的候选路径是**用户自己机器上的安装位置**,
  属于排障必需信息，可以展示；但不要把 `home` 之外的路径或会话内容带出来。
- 真机验证：`cargo run` 起应用后手动跑一次整会话分析，确认能出报告。

## 关联

- GitHub Issue: #53（`fix(sessions): 装了 claude CLI 仍报「未找到」`）
