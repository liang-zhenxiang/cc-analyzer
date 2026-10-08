# 执行计划：Round I · 证据与层级收口

> **进度（2026-10-09 终态）**：
> - I1 ✅ PR #128 已合（列预算 / 失败语义色 / 搜索转义；行高判据三轮收敛为「同引擎令牌地板」）
> - I2 ✅ PR #129 已合（ErrorState 统一、红线文案清除、监控空态可执行）
> - I3 ✅ PR #133 已合（首屏 1492→876px、图表体例、热力图例、标识符格式化、同宽）
> - I4 ✅ PR #134 已合（滚动 7 天窗口、预算可选、预设不编数；顺带修了自设上限重启丢失）
> - I5 ✅ PR #135 已合（归档截图补下半屏共 36 张、版本桩从 package.json 读 + 防漂移检查、
>   真机门禁新增几何事实、全套重出图）
> - 注意：v0.13.0-beta.2 已由另一会话发布（含 I1+I2）；#130 顺带修了先行版发布说明取段
> - 阶段 D（收尾与发布）由主会话执行：任务树归档、Round I 终章日志、v0.14.0-beta.1

## 顺序

依赖关系：**I1 / I2 / I3 可并行**（文件不重叠）；**I4 必须等 I3 合并**；
**I5 在 I1–I4 全部合并后收尾**。

文件冲突图（决定串行顺序的唯一依据）：

```
I1 → features/sessions/LogView.*、features/search/SearchPalette.*
I2 → components/ErrorState.*（新）、app/、features/usage/UsageOverviewPage.*（仅错误分支）
I3 → features/usage/UsageOverviewPage.*、charts/*、ProvenanceBadge.*
I4 → features/usage/planLimits.ts、BillingWindowCard.*、新增 WeeklyWindowCard.*
I5 → web/e2e/*、scripts/gui-test.sh、src-tauri/src/lib.rs（探针）、docs/screenshots/
```

⚠️ I2 与 I3 都会碰 `UsageOverviewPage.tsx`。**I3 先合，I2 再 rebase**
（I2 只动错误分支的十几行，冲突面小）。

## 每个子任务的完成定义

1. 单测通过，且**做过变异验证**：把实现改坏 → 新测试必须红（在 PR 描述里写出验证方式）
2. 该子任务涉及的用户可感知改动已写入 `CHANGELOG.md` 的 `[Unreleased]`，**中文条目**
3. `./scripts/lint.sh` 与 `npm --prefix web run build` 通过
4. 若有界面改动：`SCREENSHOTS=1 ... screenshots.spec.ts` 重出相关图并**由维护者目验**
5. 走 PR：`feat/*` 或 `fix/*` 分支，约定式提交标题，CI 绿后 squash 合并

## 步骤

### 阶段 A：P0 收口（I1 + I2，可并行）

- [ ] **A1** I1：`LogView` 列预算（`table-layout: fixed` + 三个新列宽令牌）、
      删 `waterfall` 列、行高收敛到 `--row-h`、失败行与状态列改用 `--danger`
- [ ] **A2** I1：`SearchPalette` 命中摘要复用 `AnsiText`（剥离转义），
      补遮罩与命中高亮 —— 与 A1 同一个 PR 或紧跟的 PR
- [ ] **A3** I2：新增 `components/ErrorState`；三个调用点归一；
      清掉夹具说明与绝对路径；错误态与「没有匹配」不再同屏
- [ ] **A4** 维护者目验 A1/A2/A3 的真机截图（日志视图浅/深、搜索浮层、错误态）

### 阶段 B：仪表盘（I3 → I4，串行）

- [ ] **B1** I3：用量总览首屏成立（内容 ≤ 852px 或让三块面板标题进首屏）；
      环形图缩小、窗口指标改网格；图表体例（刻度和日期标签、柱形填充、0 值短桩、
      热力图色阶图例）；`formatProjectPath` / `formatModelId`；
      `ProvenanceBadge` 降噪；KPI 层级
- [ ] **B2** 维护者目验 I3 的用量总览浅/深截图（**含滚动后的下半屏**）
- [ ] **B3** I4：周窗口（`planLimits` 加 `weeklyLimitTokens` + 向后兼容单测、
      滚动 7 天求和、新的限额区布局、来源徽章与「非官方重置窗口」说明）
- [ ] **B4** 维护者目验 I4 的限额区截图（选计划 / 不选计划两种状态）

### 阶段 C：证据与门禁（I5）

- [ ] **C1** 截图脚本：用量页补「滚动到下半屏」的视图，让三块面板进入归档；
      截图前把版本徽章的 mock 版本与 `web/package.json` 对齐
      （现在归档图上是 `v0.10.0`，与实际版本不符）
- [ ] **C2** e2e 新增断言：列宽稳定、首屏包含三块面板标题、搜索浮层无 ESC 字节
- [ ] **C3** 真机探针（`src-tauri/src/lib.rs` + `scripts/gui-test.sh`）扩展：
      用量总览新增「整页」几何事实（面板标题可见性）；新界面加入取图清单
- [ ] **C4** 全套重出 `docs/screenshots/`，更新 `manifest.json`，核对 README 双语首图
- [ ] **C5** 维护者亲自跑 `./scripts/gui-test.sh --build` 并逐张看图

### 阶段 D：发布

- [ ] **D1** 归档父任务与子任务树（`task.py archive`），写 Round I 终章日志
- [ ] **D2** `chore/release-v0.14.0-beta.1`：三处版本号同步、CHANGELOG 归档
- [ ] **D3** 建发布 PR → CI 绿 → squash 合并
- [ ] **D4** 确认远端无同名 tag 后推 `v0.14.0-beta.1`，验证 `gh release view`

## 回滚点

| 回滚点 | 触发条件 | 动作 |
| --- | --- | --- |
| I1 单独 revert | 列宽 fixed 布局在窄窗口下把某列挤没 | 回到 `auto` + 只删 waterfall 列 |
| I3 单独 revert | 首屏重构后仍有布局缺陷且一轮内修不好 | revert，周窗口改为独立一屏 |
| I4 单独 revert | 周窗口的诚实措辞站不住 | revert，只留 5 小时窗口 |
| 整轮 | 真机门禁反复红且归因不明 | 打 `v0.13.x` 修缺陷版，Round I 延后 |

## 验收命令（每次提交前）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e
./scripts/gui-test.sh --build
```

## 维护者闸门（不可下放给实现者）

- 亲自看每一张真机截图
- 亲自复现已报告的任何界面缺陷
- 亲自跑一次 `./scripts/gui-test.sh --build` 并读通过/失败输出
- 每个 PR 的验收独立于实现者（实现由子 agent 做，主会话只做调度与验收）