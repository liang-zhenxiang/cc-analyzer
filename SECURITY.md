# 安全策略

## 支持的版本

| 版本 | 支持情况 |
| --- | --- |
| 0.2.x | ✅ |
| 更早版本 | ❌ 请升级 |

## 报告漏洞

请通过 [GitHub Security Advisories](https://github.com/liang-zhenxiang/cc-analyzer/security/advisories/new)
私下报告安全问题，**不要**为未公开的漏洞开公开 Issue。

报告时请包含：复现步骤、受影响版本、相关日志（注意先剔除其中的会话内容与敏感路径）。
我们会在收到后尽快回应。

## 威胁模型

CC Analyzer 是一个读取本机 Claude Code 会话数据的桌面应用。它**持有和接触什么**，
决定了它的安全边界：

**它接触的数据非常敏感。** 会话记录（`~/.claude/projects` 下的 JSONL）天然包含
代码、文件路径、命令输出，甚至密钥等凭证。应用读取这些数据、解析并展示、
生成分析报告。因此：

- **数据不出本机是默认承诺**。应用的解析、聚合、展示全部在本地完成；「生成分析
  报告」会把结构化摘要交给**本机的 `claude` CLI**，由使用者自己配置与信任的
  模型服务处理——应用本身不内置任何遥测或网络上传。使用者应当意识到：生成报告
  即意味着会话摘要会流向 `claude` CLI 所使用的模型服务。
- **会话文件按不可信输入对待**。JSONL 可能来自任何项目，解析层做了约束：
  从会话文件里提取的子会话路径被限定在会话树内（防止构造的 JSONL 让应用读取
  任意文件）；跨窗口传递的序列化数据经 helper 处理，敌意的 `raw` 字段不能
  破坏面板渲染；非有限的时长数值不会吞掉整个窗口。
- **实时监控页只信任本机回环来源**。`enter-float` 等窗口控制消息只接受来自
  `localhost` 上被探测端口仪表盘的 `postMessage`，外部来源无法操纵窗口。
- **构建与发布产物**：release 工作流从干净源码构建（不经过任何缓存路径）、
  所有 Actions 按内容 pin 到 commit SHA、`zizmor` 基线 0 findings。
  macOS 产物使用 ad-hoc 签名（无开发者证书），安装时的 Gatekeeper 提示是预期行为。

**明确不在威胁模型内**（这些情况不属于本项目的安全承诺，请勿据此报告）：

- 使用者本机已被入侵——本机攻击者可以读取应用能读取的一切
- `claude` CLI 自身或其背后的模型服务的安全性
- 外部实时监控服务（`localhost:8090` 的 dashboard 不在本仓库内）的安全
- 会话数据本身的质量问题（解析失败会报 warning，不会静默出错）

## 已知的安全相关配置

- 应用数据（元数据缓存、阈值设置）存储在 `io.github.liang-zhenxiang.cc-analyzer` 的
  application-support 目录下，不与 Claude Code 的原始数据混写。
- 分析报告的生成预算（提示词大小、明细行数等）可由使用者在设置面板收紧，
  减少交给 CLI 的数据量。

## 开发期自动执行的代码（Trellis）

本仓库集成了 [Trellis](https://github.com/mindfold-ai/Trellis) 工程框架，
它会在**每次会话自动执行**下列代码。这部分**不进入任何发布产物**
（详见 `NOTICE`），但它确实会在维护者的机器上运行，因此同样受本策略约束：

| 触发时机 | 入口 | 做什么 |
| --- | --- | --- |
| `SessionStart`（含 clear / compact） | `.claude/hooks/session-start.py` | 读取 git 分支与工作区状态、当前任务、规范索引，生成一段注入上下文 |
| `UserPromptSubmit` | `.claude/hooks/inject-workflow-state.py` | 按当前任务状态注入一行提示 |
| `PreToolUse`（Task / Agent） | `.claude/hooks/inject-subagent-context.py` | 把任务上下文注入派发的子 agent |

**审查结论（2026-10-01，随集成一并复核）**：

- 三个 hook **不发起任何网络请求**——源码中不存在 `urllib` / `requests` /
  `socket` / `http` 相关调用。
- 唯一的子进程调用是 `git branch --show-current` 与 `git status --porcelain`
  （只读，超时 3 秒），以及在项目内执行 `.trellis/scripts/` 下的 Python 脚本。
- hook 脚本本身不含 `eval` / `exec`。

**由此产生的两条约定**（改动时不得违反）：

1. **`.trellis/scripts/`、`.claude/hooks/`、`.claude/settings.json` 是「会被自动
   执行的代码」**，不要当作普通文档改动。任何修改都必须在 PR 里说明执行时机与
   影响面，并与本文的审查结论保持一致。
2. **`.trellis/` 下的脚本只允许在本机执行**，不得引入网络访问；`tasks/` 与
   `workspace/` 里的内容是开发者与 AI 的工作记录，可能包含会话片段，
   **提交前须剔除敏感内容**（与顶层「会话数据视同敏感数据」同一条规则）。
