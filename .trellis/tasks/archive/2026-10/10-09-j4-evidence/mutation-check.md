# J4 变异验证记录（2026-10-09）

> 方法与 J1–J3 相同：定向破坏（改坏 → 真跑 → 期望变红 → 还原 → 复绿）。
> 本任务的差异在于**门禁级**变异改的不是产品代码，而是取证链路本身
> （探针锚点 / 门禁步骤清单）——要证的是「门禁真的在看」，不是「门禁跑得欢」。

## 一、J1–J3 变异验证汇总

三个实现任务各自留有完整记录，此处只汇总结论与抓手（明细见各自任务目录）：

| 任务 | 变异 | 破坏点 | 被谁抓住 | 记录 |
| --- | --- | --- | --- | --- |
| J1 | logicalParentUuid 挂靠改成 parentUuid | `parseJsonl.ts` `consumeCompactBoundary` | `parseJsonl.test.ts` + `contextSeries.test.ts`（4 红断崖锚点全丢） | [j1/mutation-check.md](../10-09-j1-parse-compact/mutation-check.md) |
| J1 | 删掉「摘要排除用户消息统计」 | `usageAggregations.ts` `aggregateSession` | `usageAggregations`（messages 240→242） | 同上 |
| J2 | 删掉降采样的「断崖强制保留」 | `contextCurve.ts` `downsampleCurve` | `contextCurve.test.ts`（断崖被分桶磨圆） | [j2/mutation-check.md](../10-09-j2-context-tab/mutation-check.md) |
| J2 | 删掉被丢清单的「仅用户」过滤 | `DroppedList.tsx` `shown` | `ContextView.test.tsx`（过滤档形同虚设） | 同上 |
| J3 | 摘要重新以用户行进表 | `logRows.ts` `buildLogRows` | `logRows.test.ts`（摘要折叠进带行是产品行为） | [j3/mutation-check.md](../10-09-j3-integration/mutation-check.md) |
| J3 | compactionStats 跨会话累计改直读 | `compactionStats.ts` `droppedTokens` | `compactionStats.test.ts`（数据约束 #4 双重计数） | 同上 |

六条变异全部当场变红、还原后复绿，断言均非恒真。

## 二、门禁级变异（J4 新增）

**门禁这轮真的抓到东西了**——主会话亲自跑全量门禁时，「点选压缩事件 chip」步骤
连续失败。逐层归因（探针临时加 chip 的 aria-pressed 事实、换图表命中区对照、
回执通道重试），挖出**三个真缺陷**，全部修复后 170/170 全绿：

1. **产品缺陷（ContextView.tsx）**：选中态的清空 effect 依赖 `parsed` 对象身份——
   真机后台重解析（缓存写回 → 会话刷新 → 新对象）会在点击后数秒内把选中抹掉；
   Playwright mock 没有后台重算，e2e 永远撞不见。修复：依赖改 `parsed.sessionId`
   （切会话才清空）。回归单测 2 条：「同会话重解析不丢选中」「换会话才清空」。
2. **门禁缺陷（lib.rs）**：`点选=` 动作走 `webview.eval()`（单向无回执），真机上
   脚本被静默丢弃（chip 全程未选中、无任何日志）。修复：点选改走
   `evaluateJavaScript` 带回执通道（与探针同路），回执 `clicked`/`missing` 进应用日志。
3. **断言口径缺陷（gui-test.sh + PROBE_JS）**：①被丢清单行数读不出来——探针在
   滚动容器内部找 `h3`，而标题在容器外的 header（`closest('section')` 修正）；
   ②清单总高对不上行数 × 行高——滚动容器含内边距且行高被 `Math.round` 抹掉亚像素
   （35.39→35，82 行累计差 32px）——改为对 `<ul>` 自己的 scrollHeight 对账、
   行高不取整（同 Round I「量同一个元素」教训）。

### 门禁级变异验证（改坏门禁本身 → 必须红）

- **变异 A（探针锚点）**：把 PROBE_JS 里 `forensic-card` 改成 `forensic-card-x`
  重编译重跑（`CCA_GUI_CAPTURE_TAB` 限定上下文三步）→
  `BAD|点选=…：取证卡没有渲染`——判据真在看锚点，不是恒真。
- **变异 B（步骤清单）**：从 CAPTURE_TARGETS 删去「上下文」与「点选」两步重跑 →
  末尾视图覆盖判定红（`seen_context == 0` 分支触发「上下文视图从未被取图」）。
  两条还原后全量 170/170 复绿（`/tmp/gate-full3.log`，2026-10-09）。

### 教训（值得进 spec）

- **mock 的盲区就是真机门禁的存在理由**：单测 810 绿、e2e 双引擎 172 绿，
  依然放过了「后台重解析抹掉选中态」——只有真机的异步刷新能撞见。
- **eval() 是单向黑盒**：取证类动作必须带回执，否则失败时无从归因。
- **像素对账三要素**：量同一个元素、不取整亚像素、容忍 ±4px。
