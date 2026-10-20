# Round X 选题与前提核实（主会话）

> 本文件是主会话（调度者 + 验收者）的选题记录，不替代设计规格与 PRD。

## 本轮主题

**上下文出血点——把「这次会话哪里烧钱」变成一份可执行的整改清单。**

（英文 key：`context-bleed`；分支 `feat/context-bleed`）

## 为什么是它（前提核实）

1. **差异化底子在上下文**：Round M 的竞品调研（`research-competitors-round-m.md`）与
   Round W 的对比（`research/tokentracker-comparison.md`）都指向同一结论——
   竞品（ccusage / sniffly / CCHV / TokenTracker）做的是**用量与花费的横向统计**，
   没有任何一家做**「上下文里到底是什么在烧」的纵向取证**。而本项目已经有别人没有的原料：
   `CompactEvent`（压缩前后体量、丢弃量、幸存 uuid、logicalParentUuid）、
   `droppedMessages.ts`、`contextSeries.ts`、`ChangedFilesView` 的文件改动清单、
   `structuredToolResult` 的结构化工具结果。
2. **现有的「上下文」标签页只回答「什么时候压缩的」，不回答「为什么涨到要压缩」**。
   用户真正的痛点是「我这一轮为什么这么贵 / 下次怎么少烧」——现在没有任何一处给出可执行的答案。
3. 不重复造轮子：不与 #203 脉搏（此刻实时）、N1 错误档（失败规律）、N3 工具普查
   （调用次数）重叠；它是**同一批记录的第三种切面**：成本归因。

## 口径与红线（沿用项目既有诚实口径）

- 只读本机日志，零新增网络请求、零新增 Tauri 命令、零遥测。
- **不发明新指标**：所有归因走既有的 token 四类计数器
  （`inputTokens` / `cacheCreationTokens` / `cacheReadTokens` / `outputTokens`），
  沿用 `tokenTotals.ts` / `measuredRows.ts` 的既有口径，不拿估算冒充实测。
- **成本归因分层**：上下文四类 token 的体积是**日志事实**；折算成美元走既有
  `pricingSnapshot`，定价未知的模型如实标「定价未知」，金额标注为已知部分合计。
- **不预测**、不外推「还能撑几分钟」。
- **空态与「有数据的零」必须分开**（项目既有约定）。

## 前提核实结论

- ✅ 数据原料已存在（上列各模块），**不需要**新的解析层改动。
- ✅ 无 Tauri/Rust 改动需求 —— 本轮的写范围收敛在 `web/`、`scripts/`、`docs/`。
- ⚠️ 截图视图清单硬编码在三处（Issue #196）：本轮**必须新增视图**，
  因此要么先修 #196，要么本轮同步三处并加一条 meta 检查。**决定：本轮顺带落地
  #196 的单一权威清单**，否则每加一个视图都在踩同一个坑（N1、#193 已踩两次）。

## 本轮的刀口（并行，写范围不重叠）

| 刀口 | 内容 | 主要写范围 |
| --- | --- | --- |
| X1 | `bleedModel.ts` 纯函数 + 单测（归因算法） | `web/src/features/sessions/bleed*.ts` |
| X2 | 「出血点」标签页 UI（消费 X1 契约） | `web/src/features/sessions/BleedView.*` |
| X3 | 会话列表出血点徽章 / 跨会话入口 | `web/src/features/sessions/SessionList.*`、`SessionAnalyzerPage.*` |
| X4 | #196 截图视图清单单一权威 + meta 检查 | `scripts/check-screenshots*.sh`、`web/e2e/screenshot-views.ts` |

**依赖**：X1 先落地契约（纯函数签名），X2/X3 依赖 X1。X4 独立可并行。

## 验收（主会话亲自执行，不外包）

- `./scripts/lint.sh`
- `npm --prefix web test`
- `npm --prefix web run build`
- `npm --prefix web run test:e2e`（Chromium + WebKit）
- `cargo fmt --check` / `cargo clippy -D warnings` / `cargo check` / `cargo test`
- `./scripts/gui-test.sh --build`（真机；主会话亲自看截图）
- 乱码扫描（U+FFFD）
