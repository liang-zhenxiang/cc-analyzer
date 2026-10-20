# 会话重放：把一次会话压成一段可以快进、暂停、逐帧定位的影片

## Goal

会话分析到现在为止把一次会话**摊平**成了静态的东西：日志表、树、上下文曲线、
出血点清单。它们都回答「有什么」，没有一个回答「**它是怎么发生的**」——那 47 分钟
里到底卡在哪、哪一分钟在烧钱、上下文是慢慢涨上去还是突然爆掉的。

这一轮把时间**做成一条轴**：会话详情新增「重放」视图，把整段会话压成一段固定
片长的影片。播放头往前走，当前事件、累计消耗、上下文水位跟着变——**会话第一次
可以被「看」完，而不只是被读完**。

用户价值：复盘一次昂贵的会话时，先看 60 秒重放，就知道时间花在哪、钱烧在哪、
该从哪里改；而不是在几百行日志里靠猜。

## Background（已核实的事实）

- **数据已经全部在手**，零新增 I/O：
  - `buildLogRows(records, turns, compactEvents)` 产出的 `LogRow[]` 已带
    `timestamp / durationMs / kind / status / tokens / compact`，且**已按时间排序**，
    压缩边界是独立行、等用户间隙是合成行（`gap: { start, end }`）。
  - `contextSeriesOf(records)` 给出逐次调用的上下文体量采样（`ContextSample[]`），
    `compactionAnchors` 已能定位压缩断崖。
  - `estimateCost(totals, model)` 是既有唯一计价口径；`null` 表示定价未知。
  - 会话页面已有 `parsed`（`ParsedSession`：`records` / `turns` / `compactEvents`）。
- **标签栏已有 5 项**：`日志视图 | 树视图 | 上下文 | 改动 | 出血点`，
  `cca-analyzer-view` 持久化当前项；新增第 6 项沿用同一机制。
- **既有口径不可另起**：时长口径、token 口径、成本口径都必须复用现有函数。
- **窗口不可重叠**（本项目规则：一个概念一个窗口）：重放只做**单个会话内部的
  时间轴**，不做跨会话、不做日历、不做区间选择。

## Requirements

### R1 入口

- 会话分析标签栏新增第 6 项 **`重放`**（`AnalyzerView = ... | "replay"`），
  `cca-analyzer-view` 记住它；默认仍是 `log`，既有 5 项行为一字不动。
- 未选中会话 / 解析中 / 解析失败时，重放页走与其它标签同一套空态与骨架。

### R2 纯逻辑层 `web/src/features/sessions/replayModel.ts`

无 React、无 `Date.now()`、无 I/O——所有函数吃显式输入。建议接口（实现可微调，
但**语义必须一致**）：

```ts
export type ReplayKind = "user" | "llm" | "tool" | "subagent" | "workflow" | "wait" | "compact";

export type ReplayEvent = {
  id: string;
  kind: ReplayKind;
  at: number;                 // 真实时间戳（ms）
  durationMs: number | null;  // 未知为 null，不写 0
  label: string;              // 行标签（复用 ROW_KIND_LABELS 语义）
  detail: string;             // 已剥 ANSI 的摘要，单行
  isError: boolean;
  tokensPrompt: number;
  tokensOutput: number;
  costUsd: number | null;     // null = 定价未知；没有 token 读数也是 null
  rowId: string;
};

export type ReplayMarkKind = "start" | "first-error" | "costliest-minute" | "longest-gap" | "compact";
export type ReplayMark = { id: string; kind: ReplayMarkKind; at: number; label: string; detail: string };

export type ReplayFilm = {
  start: number;
  end: number;                // 墙钟跨度，首条记录 → 末条记录
  events: ReplayEvent[];      // at 升序
  marks: ReplayMark[];
  totals: ReplayTotals;       // 事件 / 工具 / 错误 / 压缩 / token / 成本 / 未定价计数
};

export type ReplayFrame = {
  progress: number;
  at: number;
  current: ReplayEvent | null;      // 播放头所在（或刚过）的事件
  gap: { start: number; end: number } | null;  // 当前处于停顿中时给出
  passed: ReplayTotals;             // 累计到播放头
  context: { tokens: number; at: number } | null; // 最后一个 ≤ 播放头的上下文采样
};

export function buildReplayFilm(
  rows: readonly LogRow[],
  records: readonly SessionRecord[]
): ReplayFilm;

export function realMsAt(film: ReplayFilm, progress: number): number;
export function progressAt(film: ReplayFilm, realMs: number): number;
export function frameAt(film: ReplayFilm, realMs: number, samples: readonly ContextSample[]): ReplayFrame;
```

**口径要求（会被单测钉住）**：

1. **墙钟跨度** = `min(记录时间戳)` → `max(记录时间戳)`。这是**墙钟**，界面上必须
   写「墙钟」；不要冒充会话头部那个「活动时长」（区间并集口径），两者数字本就不同。
2. **token**：`tokensPrompt` = prompt（input+cacheCreation+cacheRead）与
   `tokensOutput` 分开；没有 `usage` 的事件一律 0，但**用一个计数说明有几条没有读数**，
   不把 0 说成「没消耗」。
3. **成本**：逐事件按 `estimateCost` 计价；未知定价 → `costUsd: null` 并计入
   `costUnknownEvents`。总成本 = 已知部分之和，`null` 只在整个会话一条都算不出时出现。
4. **最烧的一分钟**：在所有「以事件时间为起点、宽 60 秒」的窗口里取 token 合计最大者，
   并列取**更早**；窗口内至少一个事件。
5. **最长停顿**：相邻事件之间的最大间隔（用相邻 `at` 差值）；并列取更早。
   若会话只有一个事件则没有该跃点。
6. **跃点顺序**按时间升序；同一时刻多个跃点保持稳定顺序（start → compact → error → 其它）。
7. `progressAt` / `realMsAt` 必须是**互逆的严格单调**函数；`progress` 夹在 `[0,1]`；
   零跨度（`start === end`）时两者都返回边界值且 `progressAt` 恒为 0。

### R3 界面（设计师出规格后实现）

组成（具体版式由 design 规格决定）：

- **舞台**：当前事件卡——类型、时刻、时长、摘要、是否失败；处于停顿中时如实说
  「停顿 N 分 N 秒」并显示两端事件（不是伪造一个事件）。
- **读数**：累计消息 / 工具 / 错误 / 压缩；prompt 与 output token 分开；
  成本（未知写「定价未知」）；**上下文水位条**带压缩断崖标记。
- **胶片带**：全宽时间轴，事件按类型区分（颜色 + 形状双通道，不能只靠颜色），
  播放头可拖、可点跳；跃点有独立标记。
- **传送带**：播放 / 暂停、上一个 / 下一个事件、起止、片长选择（30 / 60 / 120 秒）、
  「跳过停顿」开关（跳过 ≥60 秒的空档，开启时写明「时间轴不再是等速的」）。
- 显示**实际倍速**：`墙钟跨度 ÷ 片长`（例如「约 63×，60 秒看完」）。

### R4 诚实性（本项目的设计原则，逐条验收）

- 播放头不在任何事件上时，显示停顿而不是「最近事件」；未来事件不得显示成已发生。
- 上下文水位只取 `timestamp ≤ 播放头` 的采样；没有采样时写「本段没有可核对的上下文读数」。
- 定价未知的事件在成本栏标明未计入条数；不把 `null` 渲染成 `$0.00`。
- 空档跨越压缩边界时，压缩必须作为事件被播放到（不能跳过）。
- 零跨度 / 单事件 / 全部事件同一时刻 / 没有 token 读数，各有如实形态，**不得合并成一句**。

### R5 性能与生命周期

- 零新增 Tauri 命令、零新增 `Bridges` 接口、零新增网络请求、零新增权限。
- 播放用 `requestAnimationFrame`；页面不可见（`document.visibilityState === "hidden"`）时暂停；
  组件卸载清理；`progress` 更新不得触发全量重算（`useMemo` + 二分查找）。
- 合成 10,000 行会话夹具量一次单帧耗时，写进 PR；目标 < 16 ms。

### R6 无障碍

- 键盘：`Space` 播放/暂停（焦点在视图内、且不在输入框时）、`←/→` 上/下一事件、
  `Home/End` 起止；胶片与滑块都是可达控件；`aria-live="polite"` 只在**事件切换**时
  播报一句，不逐帧播报。
- `prefers-reduced-motion: reduce` 时：不自动播放、水位条与播放头不做补间动画。
- 两个图表（胶片带、水位条）`role="img"` + 文字摘要。

### R7 视觉与主题

- 浅 / 深 / 高对比度三档、字号 130%、960px 窄窗**无横向溢出**。
- **目标零新增颜色令牌**：复用既有类别色与 `--danger` / `--warning` 等语义色；
  若必须新增，给出 WCAG 对比度计算（正文 4.5:1、图形 3:1）与可复现脚本。

### R8 测试（全自动，缺一不可）

- **单元** `replayModel.test.ts`：上面 R2 的 7 条口径逐条钉住；空输入、单事件、
  零跨度、同刻事件、未知定价、压缩跃点、并列取更早、progress↔real 互逆。
- **组件** `ReplayView.test.tsx`：四态（空/加载/错误/正常）、播放/暂停、点跃点、
  点胶片跳转、键盘、reduced-motion、成本未知文案、停顿文案。
- **端到端** `web/e2e/replay.spec.ts`（Chromium **+ WebKit**）：进入重放、播放头推进、
  点跃点定位、点胶片、开关「跳过停顿」、断言确定数值。
- **真机** `./scripts/gui-test.sh`：新增一步进入重放、断言无横向溢出与关键读数、
  截图（纳入 `scripts/check-screenshots.sh` 的视图清单）。
- **回归**：`npm --prefix web test`、e2e、cargo、clippy、lint 全绿。

### R9 文档

- `CHANGELOG.md` 的 `[Unreleased] → Added` 一条中文条目（写清「此前错在哪 / 缺什么」）。
- README 功能列表若列了会话详情标签，同步补「重放」。
- 若新增模块进 `docs/ARCHITECTURE.md` 的模块表。

## Out of scope（本轮不做，写进 PR 说明）

- 跨会话 / 全天重放；导出影片或 GIF；声音；在重放里编辑或标注。
- 语音（TTS）、字幕生成、分享链接。

## Acceptance Criteria

- [ ] 会话详情第 6 个标签「重放」，既有标签行为不变
- [ ] 播放 / 暂停 / 上下一事件 / 起止 / 片长 / 跳过停顿 全部可用且可键盘操作
- [ ] 舞台、读数、胶片带、水位条按设计规格实现，四态如实
- [ ] 最烧一分钟 / 最长停顿 / 首次失败 / 每次压缩 可一键定位
- [ ] Chromium + WebKit e2e 全绿；真机门禁含重放一步与截图
- [ ] 单测覆盖 R2 全部口径；130% 字号与 960px 窄窗无横向溢出
- [ ] CHANGELOG / README 更新
