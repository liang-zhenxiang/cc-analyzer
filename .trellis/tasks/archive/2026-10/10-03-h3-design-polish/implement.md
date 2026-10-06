# 实施计划：H3 界面精修

> 依赖 PRD：[`prd.md`](./prd.md) · 设计规格：[`design.md`](./design.md)（**先读它，它是本任务的权威规格**）
> 分支建议：`feat/design-consistency`
> **前置**：H1 已合并。本任务与 H1 改同一批 CSS Module，并行必冲突。

## 维护者对设计文档「待决四处」的裁定

| # | 决策点 | 裁定 |
| --- | --- | --- |
| 1 | 分段控件的激活方式 | **采纳推荐：自动激活**（方向键即切换）。理由：符合 macOS 原生分段控件与 ARIA APG 默认，且「一个规格」是本轮主题 |
| 2 | 状态灯补 `role="img"` + `aria-label` + `title` | **采纳推荐：做**。零成本、纯增信息，鼠标用户也能读到状态 |
| 3 | `Panel` 迁移范围 | **采纳推荐：收敛为只迁 `TokenPanel`**。设计文档已核实五处不同构，且 `Panel` 现有 4 处真实消费者（「死代码」前提不成立）——为凑「五处全迁」加特例是本末倒置 |
| 4 | 行内动作（§B.9） | **采纳推荐：图标展开器 + 「在树视图定位」移入展开区**。满足「不悬停、不隐藏、键盘可达」三条；代价是 2 处单测改为「先展开再点」，可接受 |

`design.md` §C.3 列出的「本轮不做」清单**照单执行**，不要扩大范围。

## 步骤（顺序有依赖，别跳）

### 1. 令牌先行（§B.4 / §B.8）
先落 `tokens.css`：`--sp-05` / `--sp-15` / `--row-pad-x` / `--row-pad-y` /
`--row-pad-y-tight` / `--dur-pulse`。
**验收门**：`npm --prefix web test` 仍全绿（这一步不该改变任何视觉）。

### 2. `Skeleton` 原语（§B.2）
新增 `components/Skeleton.*`（一份实现），再改三处用法：侧栏首载、表格首载、会话头读数。
**验收门**：开启「减弱动态效果」后骨架可见且不动（拍两张间隔 1s 的截图，像素一致）。

### 3. `SegmentedControl` 共享组件（§B.1）
新增 `components/SegmentedControl.*`，替换**六处**（设计文档核实是 6 处，不是评审写的 4 处）：
`AppShell.workspaceTabs`、`SessionList` 侧栏、`SessionAnalyzerPage.viewTabs`、
`ReportPanel` tabs、`UsageOverviewPage.rangeTabs`、`UsageOverviewPage.classTabs`。
- **必须保留** `role="tablist"` / `role="tab"` / `aria-selected`；**tab 文案一字不改**
  （§C.1 已逐条 grep：13 处 e2e 依赖它们，`search-palette.spec:46` 还用了 `exact: true`）。
- 补方向键导航（自动激活）。
**验收门**：`npm --prefix web run test:e2e` 全绿——这一步是最容易打掉 e2e 的地方。

### 4. 行密度与表头对齐（§B.4）
三张表统一引用行内边距令牌；表头文字左边距 = 数据行内容左边距；记录表数据行高 = 表头高。

### 5. 筛选 chip-toggle（§B.7）
记录类型与状态统一为 chip-toggle。**同步修改** `FilterBar.test.tsx` 的选择器
（`getByLabelText("用户")` → `getByRole("button", { name: "用户" })`），并在 PR 里注明。

### 6. 行内动作收口（§B.9 R1/R2）
- 展开器改图标切换器（字形 `▶/▼`，**不引入图标库**），**可访问名保持「展开」/「收起」不变**
  ——这恰好规避 4 处既有单测（设计文档已核实）。
- 「在树视图定位」移入**展开区顶部**（右对齐，仅当该行有记录时渲染）。
- 同步改 2 处单测为「先展开再点」，并保留 `LogView.test.tsx:169` 的否定断言语义。
- **明确不做** hover/focus-within 揭示（§B.9 R3）。

### 7. 状态列层级 + `TokenPanel` 迁 `Panel` + `ErrorBoundary` 收口（§B.5 / §B.9）
- 状态列非异常值降 `--text-tertiary`（**禁止** `--text-faint`），异常值保持 `--danger`；
  两张表同步。
- `TokenPanel` 迁到 `Panel`：`Panel` 必须支持 `ariaLabel` → `<section aria-label="Token 计数">`，
  表格结构与两句文案原样搬入（`smoke.spec:79/85/88/91` 依赖它们）。
- `ErrorBoundary` 的按钮改走 `Button` 组件，`global.css` 里不再有手写按钮样式。

### 8. 重出截图并目验
```bash
SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档"
./scripts/check-screenshots.sh     # H1 建的基线检查必须仍然通过
```
- 逐张对照 `design.md` §D 的验收清单（尤其 D.1 一致性与 D.2b 行内动作）。
- 浅色与深色**都要看**；§C.2 点出的四处主题失衡风险逐一确认。

## 全量验收（主会话执行）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
./scripts/gui-test.sh --build
```

## 提交

- 分支 `feat/design-consistency`，提交信息 `feat(web): 收敛分段控件、加载态与行内动作，统一密度令牌`。
- CHANGELOG `[Unreleased]`：一致性收敛记 `Changed`，新增 `SegmentedControl`/`Skeleton`
  两个组件可另记 `Added`。**中文条目**。

## 回滚点

- 步骤 2 与 3 各是新组件 + 调用点替换，**逐个调用点替换、每替换一处跑一次 e2e**，
  出问题能定位到具体调用点；不要一次性全换再跑。
- 步骤 6 改的是既有交互，若 e2e 出现连锁失败，先确认「是不是可访问名被改了」——
  设计文档已明确要求名字不变，改名就是偏离规格。
- `design.md` §C.3 的「不做」清单是**保护**，不是待办：任何人想加做，先在 PR 里论证。