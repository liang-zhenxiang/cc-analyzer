# 设计：实时脉搏

> 本文件只写技术设计。视觉与交互规格由设计师 agent 另出
> （`.trellis/workspace/liangyuxiang/design-round-w-live-pulse.md`），主会话评审后实现。

## 1. 边界

```
MonitorPage (标签入口，保留)
├─ 分段控件：脉搏 | 外部仪表盘
├─ ExternalDashboard   ← 现 MonitorPage 的状态机，原样搬入，行为不变
└─ PulsePage           ← 新增
     ├─ usePulseFeed()          调度 + 读文件 + 产出 PulseSnapshot
     ├─ pulseModel.ts           纯函数：新近度、分桶、参考带、上下文窗口
     └─ 展示组件（表盘/速率曲线/会话行/上下文曲线），规格见设计师文档
```

不新增 Tauri 命令，不新增 `Bridges` 接口：全部走现有 `fs.stat / readDir / readText / readHead`。
`custom.enterFloatMode / exitFloatMode` 已存在。

## 2. 数据流

```
每 DISCOVERY_MS     repository.listSessions() → recentSessionsFor(now)      (14 天，与托盘同口径)
每 FAST_TICK_MS     对 active 集合（5 小时内有 mtime 的文件）逐个 stat
                    mtime/size 变了的才 readText + parseJsonlTextAsync     (sharedSessionParseCache)
                    └→ inputs: UsageSessionInput[]
                         ├→ billingReadoutsOf(inputs, now, weeklyLimit)     5 小时块 / 归因 / 7 天
                         ├→ pulseModel.rateBuckets(records, now)            60 个分钟桶
                         ├→ pulseModel.recentRate(records, now, 15min)      近 15 分钟实测
                         ├→ pulseModel.sessionRows(...)                     活跃会话行
                         └→ pulseModel.contextPanel(latestSession, events)  上下文窗口 + 参考带
```

- 输入集合与托盘完全相同（`recentSessionsFor`），这是「脉搏 5 小时消耗 === 用量页表盘」的前提。
  缩小回看窗口会让块边界和用量页不一致：当前块可能起于很久以前，截断会改变它的起点。
- 发现与快拍分两档：每拍都 `listSessions()` 要对全部会话文件各做一次 stat，历史会话多时浪费；
  新会话晚出现几十秒可以接受。

## 3. 调度（`usePulseFeed`）

- `setTimeout` 链，不用 `setInterval`：上一拍没结束就不会排下一拍，天然不重叠。
- 下一拍延迟 = `max(FAST_TICK_MS, 3 × 上一拍耗时)`：慢机器、大文件自动降频，不靠魔法阈值。
- `document.visibilityState === "hidden"` 时不排下一拍，`visibilitychange` 回到可见立即补一拍。
- 请求 id 守卫（`hook-guidelines.md`）：每个 `await` 之后检查是否被取代，卸载即作废。
- 失败：保留上一份 `PulseSnapshot`，附 `stale: { at, reason }`；首次即失败走 `ErrorState`。
- 初始常量：`FAST_TICK_MS=5000`、`DISCOVERY_MS=30000`。**这是起点不是结论**，实现时在一份
  合成的大夹具上量一次单拍主线程耗时，写进 PR；量不过关则拉长默认值或做 k 路归并，不硬撑。
- 重算只在「本拍观察到文件变化」时做；没变化的拍只刷新依赖 `now` 的便宜部分。

## 4. 标题解析（陷阱一的处理）

活跃会话的 `SessionMeta` 必然是 `pending`。`usePulseFeed` 内部维护 `Map<path, title>`：
未命中时 `readHead(path, METADATA_HEAD_BYTES)` → `extractSessionMetadata` → `sessionTitle`。
文件头在追加写下不会变，所以按路径缓存即可，只在内存里，**不写 `meta-cache-v2.json`**
（托盘和分析页各有自己的 `SessionRepository` 实例，各自的写队列互不知情，多一个写者会引入
读-改-写竞态）。读不到头就退回项目标签 + 会话 id 前 8 位，不留空。

## 5. `pulseModel.ts` 契约（全部纯函数，`now` 显式传入）

| 函数 | 输入 → 输出 | 要点 |
| --- | --- | --- |
| `recencyOf(ageMs)` | → `"live" \| "recent" \| "idle"` | ≤120s / ≤900s；常量具名并在测试里钉边界 |
| `rateBuckets(records, now, minutes=60)` | → `{start, tokens, partial}[]` | 按本地整分钟对齐；最后一桶 `partial: true`；无 `usage` 不计；口径 `totalsSum` |
| `recentRate(records, now, windowMs)` | → tokens/小时 | 窗口内实测，非外推；与 `burnRateOf` 同单位便于并排 |
| `contextPanel(records, events, count=40)` | → 样本 + 断崖锚点 | `contextSeriesOf` + `compactionAnchors`，只截尾部 |
| `compactionBand(eventsByRecency)` | → `{min,max,n} \| {insufficient, n}` | 仅 `trigger==="auto"` 且 `preTokens!=null`，取最近 5 次，n<3 不画 |

不重写窗口数学：5 小时块、归因、预测一律来自 `billingReadoutsOf` / `predictLimitReach`。

## 6. 浮窗

- `AppShell` 已持有 `floating`。新增：`floating && tab === "monitor" && 子视图 === 脉搏` 时不渲染顶栏，
  改渲染 `PulseFloatHeader`（`data-tauri-drag-region` + 标题 + 「退出浮窗」）。其余标签和
  iframe 触发的浮窗保持现状，避免波及。
- **子视图状态必须上提。** 「脉搏 | 外部仪表盘」若留在 `MonitorPage` 内部，`AppShell` 就判断不了
  该不该收顶栏。做法：子视图作为 `AppShell` 的受控状态，经 props 传给 `MonitorPage`，
  持久化键 `cca-monitor-view`（读写按 `state-management.md` 包 `try/catch`，未知值回落到脉搏）。
  这是对 R1 的结构性影响：`MonitorPage` 从「自带状态机」变成「受控的分段容器」。
- 浮窗态由 AppShell 传给 `PulsePage` 一个 `compact` 属性，布局用容器查询而不是靠 `floating` 硬切，
  这样主窗口被拖窄时也能自适应。
- **权限**：无边框窗口要能被拖动，需要窗口拖动权限。Tauri 2 里 `core:window:default` 我印象中不含它，
  应为 `core:window:allow-start-dragging`——**实现时到 `src-tauri/gen/schemas` 核对准确标识**，
  只加这一条，PR 写明理由（AGENTS.md 对放宽权限的要求）。`security-and-permissions.md` 的「当前已授予」
  列表同步更新。
- 已知未核实：现有 iframe 浮窗是否本来就不能拖。无论答案如何，原生脉搏浮窗必须自带拖动区。

## 7. 兼容与回归面

| 面 | 影响 | 处理 |
| --- | --- | --- |
| `MonitorPage` 默认态变化 | smoke / error-states / screenshots 三处 e2e 断言旧默认态 | 先切到「外部仪表盘」再断言；#55 的不变量（不自动探测、点击才探测）原样保留，改断言的理由写进 PR |
| 截图基线 | `monitor` 视图含义改变，新增 `pulse`、`pulse-float` | 同改 `screenshots.spec.ts`、`check-screenshots.sh`、`check-screenshots-test.sh`、`manifest.json` 四处 |
| 真机门禁 | `CAPTURE_TARGETS`「实时监控」步现在抓到的是脉搏 | 夹具用 `date -u +格式串` 现算时间戳（**禁用 `date -r`**，见 AGENTS.md）；探针一律 `data-probe` 锚点，禁裸标签选择器 |
| 托盘 | 与脉搏并行解析同一批文件 | 共享 `sharedSessionParseCache`；偶发重复解析是良性的，不为此重构托盘 |
| e2e 桩 | 需要「两拍之间文件增长」 | `tauri-mock.ts` 增加可变文件与 mtime 的测试钩子（`window.__CCA_E2E_*`，仅桩内存在，不进发布包） |

## 8. 风险与取舍

- **大文件整文件重读**：活跃会话每拍变化就整文件重读重解析。解析分片让出主线程、自适应间隔兜底，
  但未在大文件上量过吞吐。已列为实现期必须量化的验收项，增量追加解析留作后续。
- **新近度只是 mtime 的推论**：长时间的工具执行期间不写日志，会被判成「更早」。因此界面只说
  「N 分钟前有新记录」。
- **参考带可能混入不同模型**：取「最近 5 次」降低混入概率，不能消除，所以展示 n 和区间而非单点。
- **真机拖动与 Windows 无法自动验证**：CI 不跑 GUI，也没有 Windows 真机；PR 里如实写。
- **取舍**：不做文件监听（轮询足够且零依赖）；不改托盘（降低对近期已发布功能的回归风险）。

## 9. 回滚

全部改动集中在 `features/monitor/`、`AppShell` 的浮窗分支和一条能力声明。回滚 = 还原
`MonitorPage` 入口到旧状态机并移除该权限；`tauri-mock` 的钩子与新增夹具不影响其他用例。
