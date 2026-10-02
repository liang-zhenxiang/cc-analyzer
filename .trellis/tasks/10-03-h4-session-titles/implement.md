# 实施计划：H4 会话「复制 resume 命令」

> 依赖 PRD：[`prd.md`](./prd.md) · 分支建议：`feat/copy-resume-command`
> **顺序**：排在 H3 之前。两者都动 `SessionHeader`，必须串行；
> H3 会做最后一套截图重出，所以把「小改动」放前面能省一次出图。

## 1. 先核实命令形态（不要凭想象拼字符串）

```bash
claude --help | grep -A2 -- "-r, --resume"
```

已核实：`-r, --resume [value]  Resume a conversation by session ID`。
**必须自带目录**——Claude Code 按项目目录组织会话，从别的目录 `--resume <id>` 未必找得到。
所以命令形态是：

```
cd "<cwd>" && claude --resume <session-id>
```

- 路径含空格或特殊字符时要正确引用（双引号 + 转义 `"`、`$`、`` ` `` 等）。
- `cwd` 缺失 → 降级为只复制 `claude --resume <session-id>`，
  并**在旁边明示**「需在该会话的项目目录下执行」——降级要可见，不能静默给一条会失败的命令。
- `sessionId` 缺失 → 按钮**禁用**并说明原因。

## 2. 落点

- `SessionHeader.tsx` 的既有动作区（与「打开位置」同一档），走既有 `Button` 组件。
- 用既有 `clipboard` 桥（`web/src/api/types.ts` 的 `ClipboardService`），
  **不新增 Tauri 命令、不动 capability**。
- 反馈沿用既有 `runAction(...)` 提示语言（如「已复制 resume 命令」）。

## 3. 隐私红线

命令串含用户路径与会话 ID，属敏感数据（`AGENTS.md`）。

- **不得**把它写进任何日志（`console.log` / `console.debug` / 错误信息）。
- 单测与 e2e 一律用**假数据**（假 cwd、假 sessionId），不引用真实路径。
- 完成后自查并在 PR 里贴出证据：

```bash
grep -rn "console\.\(log\|debug\|info\)" web/src/features/sessions/SessionHeader.tsx
```

## 4. 测试

| 层 | 要补什么 |
| --- | --- |
| 单测 | 三条路径：完整（逐字符断言命令串）/ 缺 `cwd`（降级 + 提示存在）/ 缺 `sessionId`（按钮禁用 + 原因）。另加一条：含空格与引号的路径被正确引用 |
| 单测 | 复制失败（剪贴板抛错）时有可见错误提示，不静默 |
| e2e | 真实点击「复制 resume 命令」→ 断言 mock clipboard 收到预期字符串 |

夹具沿用 `web/tests/fixtures/`，不新增真实数据。

## 5. 全量验收（主会话执行）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e
./scripts/check-screenshots.sh      # H1 建的基线检查
./scripts/gui-test.sh               # 若改了构建产物才需要 --build
```

改了可见 UI → 需重出截图（`SCREENSHOTS=1 ...`）。但**若 H3 紧随其后**，
可与 H3 合并出一次图（在 PR 里说明；H1 的基线检查会在 H3 完成前一直红，
所以更稳妥的做法是本任务先按需局部重出，H3 再整体重出）。

> 取舍建议：本任务只在 `SessionHeader` 加一个按钮，**照常重出全套**（成本几分钟，
> 换来每个 PR 都自成体系、基线检查恒绿）。不要让任何一个 PR 靠「下一个 PR 会补」蒙混过关。

## 6. 提交与收口

- 分支 `feat/copy-resume-command`，提交信息 `feat(web): 会话支持一键复制 resume 命令`。
- CHANGELOG `[Unreleased] → Added` 中文条目。
- **回帖 Issue #72**：说明核实结论（摘要标题已实现、本轮补 resume 命令），
  合并后关闭该 Issue。

## 回滚点

- 改动是「新增一个按钮」+ 一个纯函数（命令串构造）。把纯函数抽出来单独测，
  出问题只需回退 `SessionHeader` 的一处渲染与那个函数。
- 若发现 `sessionId` 在部分会话上确实缺失（真实数据里存在），**不要**放宽按钮条件，
  按 PRD 的降级规则处理并如实记录比例。