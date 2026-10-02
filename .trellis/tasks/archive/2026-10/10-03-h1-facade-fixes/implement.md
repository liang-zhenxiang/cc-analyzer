# 实施计划：H1 修复门面视觉缺陷

> 依赖 PRD：[`prd.md`](./prd.md) · 分支建议：`fix/facade-visual-defects`
> 返工点：每步末尾的「验收门」不过就回到该步，不要往下堆。

## 0. 先复现（必须在改代码之前）

```bash
npm --prefix web install
SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档" --project=chromium
```

出图后**逐张打开** `docs/screenshots/usage-light.png` 与 `analyzer-log-light.png`，
确认缺陷 1、2 复现（不要相信本 PRD 的描述，要自己看见）。

> 注意：这一步会覆盖 `docs/screenshots/` 里的既有文件。这是预期的——
> 那批图本来就是要重建的；但**不要提交**这一步的产物，先把修复做完再统一出图。

## 1. 表盘尺寸约束

1. 定位：`web/src/features/usage/charts/Gauge.tsx` 复用 `chartPrimitives.module.css`
   的 `.chart`（`width:100%; height:auto`）。
2. 选择（实现者择优，但必须满足「不影响其他图表」）：
   - 方案 A（推荐）：给 `Gauge` 一个自己的 `.gauge` 类，尺寸来自 token
     （如新增 `--gauge-size`，或复用既有尺寸令牌并给出注释说明取值理由），
     并让 `BillingWindowCard.gaugeArea` 用 `flex: 0 0 auto` 承载它。
   - 方案 B：`Gauge` 用 `width: var(--gauge-size); height: var(--gauge-size)` 覆盖 `.chart`。
3. **禁用**：给 `.chart` 加 `max-width` 之类的全局特例——那会波及 BarChart / Heatmap /
   StackedBar / HBarChart，违反 PRD 约束 2。
4. 顺带检查 `BillingWindowCard.module.css` 的 `.gaugeArea` / `.readouts`：
   表盘收窄后读数行是否回到同一行、换行行为是否合理。
5. **验收门**：`npm --prefix web test` 中 `Gauge.test.tsx` / `BillingWindowCard.test.tsx` 全绿；
   新增单测断言表盘类名不再落在通用 `.chart` 的铺满规则上（或断言尺寸来自 token）。

## 2. 记录表横向可达

1. 在浏览器里用 Playwright 的两种视口复现：`1440×900` 与 `960×640`。
   判定「残缺列」的方法：取 `table` 的 `scrollWidth` 与容器 `clientWidth`，
   以及最后一列 `getBoundingClientRect().right` 与容器右边界的关系。
2. 定位真因（`RecordTable.module.css`、`LogView.module.css`）：
   - 若 `scrollWidth > clientWidth`：问题是「能滚但看不见」，需要**可见的横向滚动提示**。
   - 若某列 `nowrap` 撑破：按列语义决定是否允许换行（摘要列本就该 `ellipsis`）。
3. 修复方向（实现者择优）：
   - 给滚动容器一个静止可见的横向滚动提示（例如仅在 `scrollWidth > clientWidth` 时
     渲染一条细滚动条/渐隐提示），**不引入新颜色**，用既有 `--border` / `--bg-hover` 档。
   - 视需要让首列（时间）`position: sticky; left: 0`，保证横向滚动时上下文不丢。
4. **验收门**：e2e 在 1440×900 与 960×640 下断言
   `lastColumnRight <= containerRight + 1`（或滚动提示可见），
   并在改动前后各截一张 `analyzer-log` 图供维护者目验。

## 3. 基线重建

```bash
SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档"
```

- 全套（6 视图 × 2 主题 × 2 引擎）在**一次运行**内出齐。
- 逐张目验：顶栏标签页数量一致、用量总览含完整的计费窗口卡片、深浅色都正常。
- README 双语引用的两张图（`analyzer-log-light.png`、`usage-light.png`）描述文字与实际画面相符。

## 4. 基线防漂移检查

目标：让「README 引用了不存在的截图」「截图套缺视图」自动失败。

- 实现方式（实现者定）：由截图套在出图时写一份清单（视图 × 主题 × 引擎 + 生成时的
  git 短 SHA），再加一个检查脚本/测试断言「README/README.zh-CN 里引用的每个
  `docs/screenshots/*.png` 都存在于仓库且出现在清单中」。
- 检查要接进 CI（`scripts/lint.sh` 或既有 e2e job，择一，理由写进 PR）。
- **变异验证（必须做）**：临时在 README 里加一行指向不存在的图，确认检查**失败**；
  撤销后再确认通过。没有这一步不算完成。

## 5. 全量验收（主会话执行，不由实现者自证）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
./scripts/gui-test.sh --build            # 真机：进程存活 + IPC 链路 + 取图非空白
```

- 真机取图后**亲自目验** `gui-artifacts/app-window-tab.png`（用量总览）与
  `gui-artifacts/app-window.png`：表盘不再撑满、无残缺列。
- 记录 `CCA_GUI_CAPTURE_TAB=用量总览 ./scripts/gui-test.sh` 的实跑输出。

## 6. 提交与 PR

- 分支 `fix/facade-visual-defects`，提交信息 `fix(web): 修复表盘撑爆与记录表列裁切，重建视觉基线`。
- CHANGELOG `[Unreleased] → Fixed` 加中文条目（描述用户能看到的变化，不写实现细节）。
- PR 描述附**修复前后对照截图**（前 = 本 PRD 引用的旧图，后 = 新出的图）。

## 回滚点

- 每步独立可回滚：步骤 1、2 是两个互不影响的 CSS/组件改动；步骤 3、4 是资产与检查。
- 若步骤 4 的检查设计成本超预期，可先只做步骤 3 并在 PR 里说明，
  **不要**为了凑检查而写一条永远不会失败的断言。