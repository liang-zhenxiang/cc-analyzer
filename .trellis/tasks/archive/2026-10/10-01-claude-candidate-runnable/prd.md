# claude 候选可执行性判定与版本目录排序

## Goal

#53（PR #57）修复「装了 claude CLI 仍报未找到」时，主会话用**真机**复核
（真实文件系统 + 真实子进程 + Finder/Dock 那种收窄的 PATH），
抓出该修复**自身遗留的两处缺陷**。本任务把它们补上。

关联 GitHub Issue：**#60**。

## 已核实的取证

本机 nvm 下两个 Node 版本装了 `claude`：

| 路径 | 形态 | 窄 PATH（`/usr/bin:/bin`）下 `claude --help` |
| --- | --- | --- |
| `~/.nvm/versions/node/v20.19.5/bin/claude` | Node 脚本，shebang `#!/usr/bin/env node` | **失败**，`env: node: No such file or directory`，退出码 127 |
| `~/.nvm/versions/node/v24.13.0/bin/claude` | 原生 Mach-O 二进制 | 正常 |

真机跑 `probeClaudeCli` 的真实结果：

```json
{ "status": "ready",
  "command": "/Users/…/.nvm/versions/node/v20.19.5/bin/claude",
  "hasStreamJson": false }
```

即：**解析到的是那个跑不起来的安装**，状态却是 ready。

## 缺陷 1：跑不起来的候选被当成「可用」

`runHelp()` 只把「错误里带 `启动命令失败`」判为启动失败。而 shebang 的
`/usr/bin/env node` 找不到 node 时，进程**确实启动了**、只是退出码 127，
stderr 是 `env: node: No such file or directory`——不含那个标记，
于是被归为 `{ kind: "ran", hasStreamJson: false }`，**当成可用**。

后果：探测报 ready、`command` 指向跑不起来的安装；真正生成报告时才失败。
候选表里明明有一个能用的（v24 原生二进制）却没去试。这也让 PRD 中
「找到了但不可执行要说清是哪种」这条要求在实践中无法兑现。

## 缺陷 2：按目录枚举顺序挑版本，不确定

版本目录靠 `read_dir` 枚举，顺序由文件系统决定（本机是 `v24, v20, v18`，
别的机器不一定）。即使修好缺陷 1，两个候选都能跑时选哪个仍不确定——
可能挑中一个很旧的 Claude Code。`cliProbe.ts` 里那句「顺序是确定的」
只对固定路径表成立，对枚举出来的版本目录不成立。

## Requirements

1. **绝对路径候选必须「真的跑通」才算可用**：`--help` 未成功（非 0 退出）的候选
   记入「不可执行」并**继续试下一个**。
   PATH 那次查找保持既有宽松语义（能启动即说明存在，不看退出码）——
   那条规则有它自己的理由（见代码注释），不要一起改掉。
2. **版本目录确定性排序**：按版本号排序，新的优先；并在注释里说清为什么
   （让「选哪个版本」是可预期的决定，而不是文件系统的偶然）。
3. 「找到了但都不可执行」的文案要**带出每个候选的失败原因**。
4. 代码注释里写明取舍：对绝对路径候选要求 `--help` 成功是**严格**的，
   若将来某个版本在 `--help` 上非 0 退出但不影响 `-p` 运行，会被误判——
   这个取舍是显式的，不是遗漏。

## Acceptance Criteria

- [ ] 测试：候选 A 存在但 `--help` 非 0 退出、候选 B 正常 → 解析结果是 **B**，
      且 **A 没有被交给执行侧**
- [ ] 测试：所有候选都非 0 退出 → 状态为 missing，文案含「无法执行」
      且**带出各候选的失败原因**
- [ ] 测试：版本目录按新→旧排序（用 `v18` / `v20` / `v24` 的 readDir 夹具），
      断言优先解析到 `v24` 的那个
- [ ] 测试：PATH 查找成功时仍返回字面量 `claude`（既有行为不回退）
- [ ] 测试：PATH 查找失败但唯一候选可用时，返回该候选的绝对路径（既有行为不回退）
- [ ] `npm --prefix web test`、`npm --prefix web run build`、`./scripts/lint.sh` 全绿
- [ ] 真机复核（主会话负责）：窄 PATH 下解析出的命令是**原生二进制那个**，
      且 `--version` 真能跑通

## Notes

- 只改 `web/src/features/sessions/cliProbe.ts` 与其测试；`report.ts` 的调用契约
  （用 `cli.command`）不变。
- 测试要写**具体路径 / 具体命令**的断言，不写恒真断言（见
  `.trellis/spec/testing/pitfalls.md`）。
