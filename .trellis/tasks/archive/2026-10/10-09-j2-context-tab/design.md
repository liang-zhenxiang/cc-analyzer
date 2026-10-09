# Design：J2 · 上下文标签页

> 视觉与交互的**唯一权威**：[`design-context-view.md`](../10-09-round-j-context/research/design-context-view.md)
> §2（视图 A 全部）、§6（令牌映射）、§7（交互）、§8（无障碍）、§9（不做什么）。
> 本文件只写实现结构，冲突时以规范为准。

## 组件结构

```
features/sessions/
  ContextView.tsx            入口：两块 Panel（上下文压力 / 压缩事件）+ 选中态
  ContextView.module.css
  contextCurve.ts            纯函数：降采样（≤720 点，保断崖/峰值）、x/y 定位、
                              峰值直标、事件命中区几何
  contextCurve.test.ts
  CompactionPanel.tsx        事件 chip 条 + 取证卡（数字栏）+ 选中态管理（ContextView 持 state）
  DroppedList.tsx            「被丢出上下文的内容」虚拟化清单（virtualWindow 复用）
  DroppedList.module.css
```

- 视图注册：`SessionAnalyzerPage` 的 `ANALYZER_VIEW_ITEMS` + `AnalyzerView` 加 `"context"`；
  上下文标签页隐藏 `TimelineTrack` 与 `FilterBar`（规范 §2.1），`viewBar` 保留。
- SVG 图表件放 `ContextView` 内部还是复用 `usage/charts/`：**轴件**（niceAxisMax/axisTicks/
  GridLine/formatAxisValue）从 `usage/charts/chartPrimitives` 导入复用（规范点名），
  面积图本体是新代码（现有只有 BarChart/HBar/Stacked/Heatmap，没有折线原语），
  放 `sessions/` 侧不反向依赖 `usage/` 的页面层——**不得** import `usage/` 的组件，
  只允许 import `charts/chartPrimitives` 这一个共享件（依赖方向：sessions 不依赖 usage 页面）。
  若 chartPrimitives 有页面耦合，先把它挪到 `components/charts/`（挪动是允许的，保持单向依赖）。

## 数据流

```
parsed.compactEvents ──┐
parsed.records ──contextSeriesOf──> samples（主对话：isSidechain === false）
                       ├─compactionAnchors──> anchors
选中事件 id（useState，非路由）
  → CompactionPanel 数字栏（useMemo）
  → DroppedList 口径：该边界前全部消息 uuid − survivedUuids −（此前边界已丢过的）
```

被丢清单的去重规则（规范 §2.4）：一条消息只在**首次**被丢的边界下列出——
实现为「前面所有边界的 survivedUuids 并集」参与排除。

## 关键实现点（规范落地清单）

1. 降采样分桶保 {min,max} + 强制保留断崖两侧点与全局峰值（contextCurve.ts 纯函数可测）；
2. tooltip 复用 TimelineTrack 的浮层画法；crosshair 二分查找；rAF 合帧；
3. 键盘：图容器 roving（←/→ 事件间、Enter/Space 选中、Esc 取消），
   清单复用 useRowNavigation；
4. 行点击跳日志视图定位（locateInLog 既有流程）；
5. 空态三分支照规范 §2.6 表格逐行实现；
6. X 轴 caption 缝合「提示词/上下文规模」两个名字（规范原文照抄）；
7. `aria-label` 模板（规范 §7）；
8. a11y：chip 是 `aria-pressed` 真按钮；图 `role="img"`。

## 兼容

- `cca-analyzer-view` 记忆键对 `"context"` 直接可用（未知值回落 log 的逻辑不动）；
- LogView/TreeView 零改动（除共享页面壳的隐藏逻辑）；
- 性能：路径 useMemo、清单虚拟化——5k 消息会话必须不卡（e2e 有大夹具断言滚动垫片）。

## 回滚

单 PR revert；视图键新增 `"context"` 对旧版本无影响。
