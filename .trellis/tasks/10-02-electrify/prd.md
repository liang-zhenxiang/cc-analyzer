# PRD：「通电」界面精修轮

> 对应 Issue #66 · 创建于 2026-10-02 · Round C
> 依据：`.trellis/workspace/liangyuxiang/design-critique.md`（UI/UX 专业评审）

## 背景

评审结论：令牌纪律与骨架层已到位，但「仪器面板」缺**读数层**——用户最关心的
数字以最小字号最弱对比出现、Token 默认不可见、时间轴有网格无刻度、状态灯常亮
无语义。「界面像一台还没通电的仪器」。本轮只加「信息」，不加「装饰」。

## 功能需求（评审 Top 项）

1. **首屏读数行**（评审 #1）：`SessionHeader` 下加 stat strip——总耗时 / 输入 /
   缓存读取 / 输出 / 记录数，`--fs-md` 15px/600 tabular 并排在 `--bg-subtle`
   台阶上；读数行可点击展开 TokenPanel（把现有 chipButton 的交互搬上来）；
   原 chips 降级为次级元信息。
2. **TimelineTrack 时间刻度轴 + hover 准线 + 块宽按时长映射**（#2）：轨道底部
   起止时间 + 2–3 个中间刻度；hover 显 1px 准线 + `--fs-xs` tabular 时间读数
   气泡（顺带解决拉选不知选到哪）；块宽按记录时长映射（min-width 2px，超长封顶）。
3. **状态灯语义化**（#9）：今天的会话 `--success`、含失败记录 `--danger`、
   更早 `--text-faint`。
4. **侧栏 toolbar 重排**（#7 部分）：「刷新会话列表」改 IconButton（refresh 图标
   已有），搜索框拿回全宽。
5. **三张表行级键盘导航**（#3）：RecordTable / LogView / TreeView roving
   tabindex + ↑↓/Enter/Home/End，复用现有 hover/选中态样式。

## 约束

- 只加信息不加装饰：明确不做渐变、玻璃拟态、彩色主题、动效装饰
- 双主题截图重出（`SCREENSHOTS=1`，仅 README 引用的那几张）
- 既有测试全绿；新交互（键盘导航、读数行展开）配单测与 e2e
- gui-test.sh 真机回归（会话分析页是首屏，读数行会出现在第一张截图里）

## 非目标

- SegmentedControl 抽取 / DataPanel / FilterBar chip-toggle（评审 #5/#8/#10，
  留给后续精修轮，避免本轮 diff 过大）
- 加载态统一 skeleton（#6，同上）

## 验收标准

- [x] 打开应用第一眼是五六个大号等宽数字（读数行），可点击展开 Token 面板
- [x] 时间轴可读出起止时刻；hover 有准线与时间气泡；块宽反映时长
- [x] 状态灯三态可辨且测试覆盖判定逻辑
- [x] 三张表可纯键盘操作（↑↓ 选行、Enter 打开详情）
- [x] 单测 + e2e（双引擎）+ GUI 真机全绿；截图按需重出
- [x] CHANGELOG `[Unreleased]` 中文条目
