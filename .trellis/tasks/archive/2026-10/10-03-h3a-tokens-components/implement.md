# 实施计划：H3a 令牌与共享组件

> **权威规格是 [`../10-03-h3-design-polish/design.md`](../10-03-h3-design-polish/design.md)**——
> 先完整读它，本文件只是把属于 H3a 的部分抽出来排个顺序。
> 父任务 PRD：[`../10-03-h3-design-polish/prd.md`](../10-03-h3-design-polish/prd.md)
> 分支建议：`feat/design-tokens-components`

## 范围（只做这三件，别越界）

| design.md 小节 | 交付 |
| --- | --- |
| §B.4 + §B.8 | 新令牌：`--sp-05` / `--sp-15` / `--row-pad-x` / `--row-pad-y` / `--row-pad-y-tight` / `--dur-pulse`；`--r-lg` 与 `--warning` 按设计的结论**保留**并补注释说明分工（不要删） |
| §B.2 | 新增 `components/Skeleton.*`（**一份实现**），替换三处加载态：侧栏首载 / 表格首载 / 会话头读数 |
| §B.1 | 新增 `components/SegmentedControl.*`，替换**六处**调用点 + 方向键导航（自动激活） |

**不做**：行密度实际套用（那是 H3b）、筛选 chip-toggle、行内动作、`TokenPanel` 迁移、
状态列层级。理由：H3a 要先把令牌与组件立起来，H3b 才有东西可依赖。

## 顺序（有依赖）

1. **令牌先行** → 跑 `npm --prefix web test`，这一步不该改变任何视觉。
2. **`Skeleton` 原语** → 再改三处用法。
   - 验收门：开启「减弱动态效果」后骨架**可见且不动**（拍两张间隔 1s 的截图，像素一致）。
3. **`SegmentedControl`** → **逐个调用点替换，每替换一处跑一次 e2e**，出问题能定位到具体调用点。
   六处：`AppShell.workspaceTabs`、`SessionList` 侧栏、`SessionAnalyzerPage.viewTabs`、
   `ReportPanel` tabs、`UsageOverviewPage.rangeTabs`、`UsageOverviewPage.classTabs`。

## 本任务最大的风险：13 处 e2e 依赖既有选择器

`design.md` §C.1 已逐条 grep 核实。硬约束：

- 组件**必须保留** `role="tablist"` / `role="tab"` / `aria-selected`
- **六个调用点的 tab 文案一字不改**（`日志视图`/`树视图`/`时间线`/`项目`/`会话分析`/
  `用量总览`/`实时监控`/`近 N 天`/`缓存输入`…）。`search-palette.spec.ts` 用了 `exact: true`，
  改文案会直接挂
- 非选中项 `tabIndex={-1}`（roving tabindex）是安全的——e2e 全部用 `role` 定位，不依赖 `tabIndex`

## 验收（主会话执行）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e          # 这一步是验证「没打掉既有用例」的关键
SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档"
./scripts/check-screenshots.sh
./scripts/gui-test.sh                  # 真机几何断言应仍然通过（布局不该变）
```

截图需按 `design.md` §D.1 目验：**六处分段控件一个样**、三处加载态一个样。

## 提交

- 分支 `feat/design-tokens-components`，提交信息
  `feat(web): 抽取 SegmentedControl 与 Skeleton，补齐密度与动效令牌`。
- CHANGELOG：组件抽取记 `Added`，加载语言收敛记 `Changed`。中文条目。

## 回滚点

- 三件事相互独立，可分别回退：令牌是纯新增；`Skeleton` 是新增组件 + 三处替换；
  `SegmentedControl` 是新增组件 + 六处替换（逐处替换本身就是回滚粒度）。
- 若某个调用点的结构差异大到共享组件要加特例，**先停下来报告**——
  `design.md` 的立场是「同一个概念只允许有一种画法」；加特例意味着规格要改，
  那应该先改 `design.md` 而不是在代码里破例。