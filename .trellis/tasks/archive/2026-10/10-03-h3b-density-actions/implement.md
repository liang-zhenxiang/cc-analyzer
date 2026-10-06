# 实施计划：H3b 密度、筛选与行内动作收口

> **权威规格是 [`../10-03-h3-design-polish/design.md`](../10-03-h3-design-polish/design.md)**——
> 先完整读它，本文件只把属于 H3b 的部分抽出来排序。
> 分支建议：`feat/density-and-row-actions`
> **前置**：H3a 已合并（本任务依赖它落下的 `--row-pad-*` / `--sp-05` / `--sp-15` 令牌）。

## 范围

| design.md 小节 | 交付 |
| --- | --- |
| §B.4 | 三张数据表统一引用行内边距令牌；表头文字左边距 = 数据行内容左边距；记录表数据行高 = 表头高（30px） |
| §B.7 | 记录类型与状态统一为 **chip-toggle**（沿用既有 `aria-pressed` + `--accent-soft` 按下态先例） |
| §B.9 R1 | 行内展开器由文字按钮改为**图标切换器**（字形 `▶`/`▼`，**不引入图标库**） |
| §B.9 R2 | 「在树视图定位」移入**展开区顶部**（右对齐，仅当该行有记录时渲染） |
| §B.9 降级建议 | 状态列非异常值降 `--text-tertiary`（**禁止** `--text-faint`），异常值保持 `--danger`；两张表同步 |
| §B.5 | `TokenPanel` 迁到 `Panel`（`Panel` 需支持 `ariaLabel` → `<section aria-label="Token 计数">`）；`ErrorBoundary` 的按钮改走 `Button`，`global.css` 里不再有手写按钮样式 |

**不做**（`design.md` §C.3 已逐条论证）：hover/focus-within 揭示行内动作、删减任何信息列、
`Toast` 离场过渡、其他面板迁 `Panel`、图标尺寸 token 化、密度切换开关。

## 必须同步修改的既有测试（`design.md` §C.1 已列明）

| 文件 | 改动 |
| --- | --- |
| `FilterBar.test.tsx` | `getByLabelText("用户")` → `getByRole("button", { name: "用户" })` |
| `LogView.test.tsx` | 直接点行内「在树视图定位」的两处 → 改为「先展开该行 → 再点展开区里的按钮」 |
| `SessionAnalyzerPage.test.tsx` | `getAllByRole("button", { name: "在树视图定位" })[0]`（此刻没有行展开，移入展开区后匹配数为 0）→ 同样改为先展开 |

**展开器的可访问名必须保持「展开」/「收起」不变**——`design.md` 已核实改名会额外打掉
4 处单测（`LogView.test.tsx` ×2、`RecordTable.test.tsx`、`SessionAnalyzerPage.test.tsx`）。
这不是偷懒，是规格：表格行内的展开器有列头提供上下文，改名无收益只有连锁成本。

`RecordDetailPanel` 里既有的「在树视图定位」（`RecordDetailPanel.tsx:207`）**保留不动**——
两者触发路径与上下文不同，且任一时刻只会有其中一处可见。口径是
「同一个动词可以有两处上下文入口，但必须共用同一种画法」。

## 验收（主会话执行）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e
SCREENSHOTS=1 npm --prefix web run test:e2e -- --grep "截图归档"
./scripts/check-screenshots.sh
./scripts/gui-test.sh                  # 真机几何断言应仍通过
```

截图按 `design.md` §D.2b 目验，重点是：
- 日志表每行右端**只剩一个 `▼/▶` 字形**，不再有按钮墙
- 展开任意行：动作条在**展开区顶部、右对齐**，与右栏详情那颗**长得一模一样**
- 展开「等用户」这类无记录行：**没有**动作条
- **悬停任意行不出现任何新控件**（验证没有引入 hover 揭示）
- 状态列正常值明显轻于「操作 / 摘要」；**灰度截图**下失败仍突出

## 提交

- 分支 `feat/density-and-row-actions`，提交信息
  `feat(web): 收口行内动作与表格密度，筛选统一为 chip-toggle`。
- CHANGELOG `[Unreleased] → Changed`，中文条目。

## 回滚点

- §B.9（行内动作）与 §B.7（chip-toggle）是两处独立交互改动，可分别回退。
- 若 e2e 出现连锁失败，**先确认是不是可访问名被改了**——规格明确要求名字不变，
  改名就是偏离规格，应当改回来而不是批量改测试。