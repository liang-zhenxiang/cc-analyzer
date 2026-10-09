# Implement：J2 · 上下文标签页

> 分支：`feat/j2-context-tab`（从合入 J1 的最新 main 切）。不 commit，主会话验收后提交。
> 规范：`../10-09-round-j-context/research/design-context-view.md` §2/§6/§7/§8/§9——先通读再动手。

## 步骤

1. [ ] `contextCurve.ts` 纯函数 + 单测：降采样（分桶 min/max、强制保留断崖两侧与峰值、
       ≤720 点）、坐标映射、事件命中区矩形、峰值直标定位
2. [ ] `ContextView.tsx` + module.css：两块 Panel、面积图 SVG（描边 --chart-1 2px /
       填充 --chart-1-soft、直折线）、Y 轴 niceAxisMax/axisTicks、X 轴消息序号
       niceStep(N/8)、caption 口径句、事件三件套（竖线/菱形/24px 命中区）、
       选中/hover 态、tooltip（crosshair 二分 + rAF）、键盘 roving
3. [ ] `CompactionPanel.tsx`：事件 chip 条（aria-pressed、横向滚动）+ 取证卡数字栏
       （dl 形态、null → 「未记录」）+ 幸存清单展开；未选中引导行
4. [ ] `DroppedList.tsx`：口径注释 + 虚拟滚动 + 全部/仅用户 SegmentedControl +
       行点击 locateInLog；「仅用户」把用户行（含被丢的用户约束）排前
5. [ ] `SessionAnalyzerPage`：视图三段、context 下隐藏 TimelineTrack/FilterBar
6. [ ] 单测：ContextView 空态三分支、chip 选中联动、取证数字 null 降级、
       DroppedList 口径（跨多次压缩去重、仅用户过滤）、视图切换持久化
7. [ ] e2e（`web/e2e/`，Chromium+WebKit）：加载含压缩夹具会话 → 切「上下文」→
       断言 SVG 曲线存在、chip 数 = 2、点 chip #2 → 取证卡数字（422,858 → 11,359）、
       被丢清单条数 > 0、行点击跳日志视图高亮；空态夹具（现有任一无压缩会话）→
       「本会话未发生压缩」文案存在
8. [ ] 全量：`./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run build`、
       `npm --prefix web run test:e2e`（现有 154 用例零回归）
9. [ ] 变异验证 ≥2 条：删「断崖强制保留」→ 降采样单测红；删「仅用户过滤」→ e2e 或单测红。
       记录进 `mutation-check.md`

## 验证命令

```bash
./scripts/lint.sh && npm --prefix web test && npm --prefix web run build && npm --prefix web run test:e2e
```

## 红线（规范 §9 摘要，实现时逐条自查）

不画上限参考线；不引图表库；不加第七类别色；不把压缩塞进树/耗时；context 页不渲染
FilterBar/TimelineTrack；不做预测；摘要不当用户行；不累加 cumulativeDroppedTokens；
不画侧链曲线；tooltip 不是唯一读数通道。
