# 设计：监控台

## 1. 边界

```
MonitorPage（既有受控分段容器）
└─ 分段控件：脉搏 | 监控台 | 外部仪表盘
   ├─ PulsePage                （既有，不动）
   ├─ MonitorConsolePage       ← 新增
   │    ├─ usePulseFeed()      （既有 hook，独立实例；解析缓存共享）
   │    └─ consoleModel.ts     纯函数
   └─ ExternalDashboard        （既有，不动）
```

不新增 Tauri 命令、不新增 `Bridges` 接口、不新增网络请求、不加权限。

## 2. 数据流

```
usePulseFeed().snapshot
  ├─ inputs : UsageSessionInput[]   （records / compactEvents / toolCalls）
  ├─ rows   : SessionRow[]          （活跃会话）
  └─ now
        │
        ├→ billingReadoutsOf(inputs, now, weeklyLimit)   既有
        ├→ consoleModelOf(inputs, rows, now)             新增，一次遍历
        │     ├─ todayTokens       本地自然日四类之和
        │     ├─ todayCompactions  本地自然日压缩条数
        │     ├─ projects[]        近 15 分钟速率 / 今日 token / 活跃会话数
        │     ├─ hourly[24]        今天的小时桶（当前小时 partial）
        │     └─ events[]          最近 12 条（压缩 / 错误 / 会话开始）
        └→ 展示组件
```

## 3. `consoleModel.ts` 契约（纯函数，`now` 显式传入）

### 3.1 类型

```ts
export type ConsoleProject = {
  projectLabel: string;
  projectPath?: string;
  /** 近 15 分钟实测 token/小时（与 recentRate 同单位）。 */
  ratePerHour: number;
  /** 本地自然日的四类 token 之和。 */
  todayTokens: number;
  /** 这 5 小时窗口内有新记录的会话数。 */
  activeSessions: number;
};

export type ConsoleHour = { hourStart: number; tokens: number; partial: boolean };

export type ConsoleEventKind = "compaction" | "error" | "session";
export type ConsoleEvent = {
  id: string;
  kind: ConsoleEventKind;
  at: number;
  projectLabel: string;
  projectPath?: string;
  sessionPath: string;
  sessionTitle: string;
  /** 压缩：auto / manual；错误：工具名；会话：空串。 */
  detail: string;
  /** 压缩 preTokens；错误为 null；会话为 null。 */
  preTokens: number | null;
  /** 错误预览（≤80 字符，脱敏）；其它为空串。 */
  preview: string;
};

export type ConsoleReport = {
  now: number;
  todayTokens: number;
  todayCompactions: number;
  projects: ConsoleProject[];
  hourly: ConsoleHour[];
  events: ConsoleEvent[];
};
```

### 3.2 函数

| 函数 | 输入 → 输出 | 要点 |
| --- | --- | --- |
| `hourBucketsOf(records, now)` | → `ConsoleHour[24]` | 本地自然日 24 个整点桶；当前小时 `partial`；无 usage 记录不计 |
| `projectStatsOf(inputs, activeRows, now)` | → `ConsoleProject[]` | 每个项目聚合今天 token、近 15 分钟实测速率、活跃会话数；按速率降序、并列按项目名 |
| `eventsOf(inputs, rows, now, limit=12)` | → `ConsoleEvent[]` | 压缩 / 错误 / 会话开始三类；跨会话；按时间降序；上限 |
| `consoleModelOf(inputs, rows, now)` | → `ConsoleReport` | 一次遍历组装；`todayTokens` / `todayCompactions` 也在这里折出 |

### 3.3 边界

- **今天** = `dayStartOf(now)` 起的 `[todayStart, now]`；未来时间戳不计。
- **近 15 分钟** = `[now − 15min, now]`，与 `pulseModel.recentRate` 同一口径
  （直接复用 `recentRate`，不另写）。
- **小时桶**：24 个，最后一个含 `now` 的那个是 `partial: true`。
- **事件上限**：先取最近 12 条再渲染；筛选在展示层做（不改变 `events` 契约）。
- **错误预览**：取 `record.text` 首行，`\s+` 折叠，截断 80 字符；**剥掉绝对路径**
  （把 `/Users/...`、`/home/...` 这类段替换为 `…`），绝不把本机路径带进 UI。
- **会话开始**：该会话首条有效时间戳记录；标题走 `fallbackSessionTitle`。
- **并列**：项目速率相同时按 `projectLabel` 升序，保证稳定。

## 4. 展示层

- 组件只吃 `ConsoleReport` + `rows`，**不做任何判定**。
- 顶部 4 枚读数复用 `BillingWindowCard` 的「标签小字 + 数值 600 + tabular」语言。
- 项目榜：每行按钮，网格 `项目 | 速率条 | 速率 | 今日 token | 会话数`；
  速率条长度 = `rate / max(rate)`；无速率（全 0）时条不渲染。
- 24h 活动带：24 根柱，当前小时用斜纹 + 虚线（与脉搏同一套 pattern 思路）。
- 事件流：三类图标（用既有 `Icon` 名称，不新画），时间 + 项目 + 标题 + 详情；
  整行按钮，点开会话。
- 四态与脉搏一致。

## 5. 兼容与回归面

| 面 | 影响 | 处理 |
| --- | --- | --- |
| `MonitorPage` 分段项 | 2 → 3 项 | 既有断言若按名称取项不受影响；按序数取的要改 |
| 外部仪表盘 | 不动 | 既有 #55 用例全绿 |
| 脉搏 | 不动 | 既有用例全绿 |
| 截图 | 新增 `monitor-console` | `docs/screenshots/views.json` 一处 |
| 真机门禁 | `CAPTURE_TARGETS` 加一步 | 探针用 `data-probe` |

## 6. 风险与取舍

- **两个 feed 实例**：脉搏与监控台各持一个 `usePulseFeed`，切换时重启调度。
  解析缓存共享，所以重复成本只有一次 `listSessions`（stat 每个文件）+ 纯函数重算。
  不把 hook 上提是为了不碰脉搏既有行为——这是本轮最大的一处「宁可重复也不动老代码」。
- **错误预览脱敏**：日志里的错误文本可能带绝对路径；预览必须剥掉，宁可少显示。
- **不做本地 HTTP 服务**：见 PRD。
