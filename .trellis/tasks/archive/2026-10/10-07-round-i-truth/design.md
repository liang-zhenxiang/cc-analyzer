# 技术设计：Round I · 证据与层级收口

本文只写**跨子任务的技术决策**。子任务内部的实现细节留在各自的 `design.md`。

## 1. 边界与不变量

### 1.1 不改的东西（本轮冻结）

| 冻结项 | 理由 |
| --- | --- |
| `web/src/styles/tokens.css` 的字号阶梯（11/12/13/15/20） | 评审第 12 条：动它会牵动全部组件，必须单独一轮。本轮对 tokens.css 的改动**仅限**本设计 §2 的新增令牌，以及 I3 明确授权的 `--chart-*-soft` alpha |
| `--cat-*` 与 `--chart-*` 两套色板的互借禁令 | 既有纪律，I1 的失败语义色走 `--danger`，**不借类别色也不借图表色** |
| `--font-scale` 缩放机制 | v0.13.0-beta.1 刚落地，本轮所有新 UI 必须兼容 90%–130% |
| Rust 侧 `parseJsonl` 的输出契约 | I1/I2 只消费既有字段，不改解析器 |

### 1.2 本轮必须成立的不变量

1. **界面文案不含绝对路径**（`/` 开头的用户目录）与**不含夹具/测试说明**。
   由 I2 的单元测试强制：把 `SessionAnalyzerPage` 的错误态渲染出来，
   断言文案里不出现 `/Users/`、不出现 `夹具`。
2. **表格列宽在筛选前后不变**。由 I1 的 e2e 断言：同一张表在切换筛选前后，
   每个 `<th>` 的 `getBoundingClientRect().width` 差 ≤ 1px。
3. **用量总览的首屏包含全部面板标题**。由 I5 的 e2e 断言：
   900px 视口下不滚动，按项目分布 / 按模型分布 / 活跃时段的标题可见。
4. **任何视图渲染出的文字里不得出现 ESC 控制字节**。这条 v0.11.0 已立，
   本轮把**搜索浮层**纳入它——现在它是漏的。

## 2. 新增令牌（本轮允许的 tokens.css 改动）

```css
/* 数据表列宽：列预算是视图级契约，写进 token 才不会「一处 CSS 决定九个列位置」 */
--col-num: 88px;      /* 次数、耗时、占比这类定宽数值列 */
--col-time: 150px;    /* 时间列：日期 + 时刻 */
--col-type: 96px;     /* 类型 chip 列 */
```

理由：评审第 4 条要求 `table-layout: fixed`。fixed 布局必须有确定的列宽来源，
散在组件里的字面量会让「加了字号缩放之后列还够不够」无法一眼判断。
**只新增三个，不新增色板、不新增字号。**

### 2.1 `--chart-*-soft` 的 alpha（仅 I3 授权）

评审第 18 条：柱形只有 10% 填充 + 1px 描边，浅色下几乎只剩描边、读不出面积。
I3 可以调整这六个 `-soft` 令牌的 alpha，**但必须同时满足**：

- 浅色与深色两套都给出调整后的对比度数值（`-soft` 用于大面积填充，
  对底色只需满足图形件的 3:1 门槛，但**不得低于现状**）
- 一次改全部六个，保持色板内部的相对关系不变
- PR 里附「改动前后」的柱图截图对照

这是本轮**唯一**允许修改既有令牌值的地方，其它令牌一律只增不改。

## 3. 契约

### 3.1 `components/ErrorState`（I2 新增）

```ts
type ErrorStateProps = {
  /** 一句话说清「什么失败了」，面向使用者，不含实现细节。 */
  title: string;
  /** 可执行的下一步（「重试」「在 8090 端口启动监控服务」），不是安慰。 */
  hint: string;
  /** 原始错误串 —— 只进 <details> / 复制按钮，绝不进正文。 */
  detail?: string;
  onRetry?: () => void;
  size?: "page" | "panel" | "inline";
};
```

三个现有调用点（侧栏内联、用量页整页、监控页）全部改走它。
`size` 三档对应评审 1.10 里那三种位置——**同一套语义只有一个组件**，位置差异靠 size 表达。

### 3.2 周窗口的诚实契约（I4）

本机日志**推不出** Anthropic 的官方周重置时刻。因此：

```ts
type WeeklyWindow = {
  /** 滚动 7 天（now - 7d, now] 的消耗 —— 读自日志的精确值。 */
  consumed: UsageTotals;
  /** 可选分母：使用者自设或预设估算。null 时不显示任何百分比。 */
  limitTokens: number | null;
};
```

- `consumed` 的来源徽章是 `logged`（精确）。
- 一旦出现百分比或推算，徽章必须是 `estimated` 或 `inferred`，并带
  「滚动 7 天，非官方重置窗口」的说明。
- **不引入 `resetAt` 字段**——我们不知道，就不给这个字段留位置。

> **裁决补记（2026-10-09，实现 #134 合并后）**：上一条在实现时有一处**有依据的偏离**，
> 维护者确认按实现为准——`estimated` 档的文案是「按定价快照估算」，而周预算是
> **使用者自己填的数字**，定价快照根本没有参与；把那枚徽章挂上去就是在给一个
> 我们并没有的依据背书。因此预算对照的百分比行**不挂徽章**，改用行内文字
> 「（预算为自设数字）」限定来源；触达推算照旧挂 `inferred`（它确实是外推）。
> 一般规则：**provenance 的档位文案描述的是「依据是什么」，不是「确定性强弱」**——
> 依据对不上就不挂，宁可用行内文字说清，也不硬借一枚语义不符的徽章
> （与 tokens.css 里「类别色不得借用」是同一条纪律）。将来若出现第三种依据
> （自设阈值），先扩词表，不要复用 `estimated`。

`PlanSelection` 从单个标量扩成两档：

```ts
type PlanSelection = {
  id: PlanId;
  /** Tokens per 5h window; null when unknown. */
  limitTokens: number | null;
  /** Tokens per rolling 7 days; null when unknown. */
  weeklyLimitTokens: number | null;
};
```

**持久化必须向后兼容**：旧值（只有 `id` 与 `customLimitTokens`）反序列化后
`weeklyLimitTokens` 为 `null`，界面退回「只显示消耗」。`parsePlanSelection`
是纯函数，这条要有单测。

### 3.3 表格的列预算（I1）

`LogView` 的表从内容驱动（`table-layout: auto`）改为 `fixed`。
`waterfall` 列**删除**，其 129px 并入摘要列；若实现时发现 waterfall 有不可替代的信息，
则降级为 `占比` 单元格的 tooltip——**但不得保留一个读不出信息的独立列**。

行高统一到单一令牌（数据行与表头等高，这条 v0.13.0 已用 `--row-h` 立过，I1 负责让
三种行高收敛到它）。

## 4. 数据流（不新增数据源）

本轮所有子任务都**只消费既有数据**：

```
~/.claude/**/*.jsonl ──Rust──▶ SessionRecord[] ──┬─▶ LogView / TreeView / Report
                                                 ├─▶ clusterBillingBlocks ─▶ 5h 卡片
                                                 └─▶ 滚动 7 天求和 ──▶ 周窗口卡片（I4 新增）
```

I4 的「滚动 7 天求和」是 `usageAggregations` 里已有日聚合的另一种切片，
**不新增对外命令、不新增文件读取路径**。

## 5. 权衡

| 选择 | 备选 | 为什么选它 |
| --- | --- | --- |
| 删除 `waterfall` 列 | 保留并加轴/标签 | 3 行的规模下它与行序等价，宽度又和 `占比` 重复；加轴只会让 129px 涨到 180px 以上，把摘要挤得更短 |
| 环形图缩小 / 换表达 | 保留 200px 环形图 | 没有选计划时进度弧恒为 0，整块是装饰——渲染一个「没有任何信息量的最大面积元素」不符合本项目性格 |
| 周窗口用滚动 7 天 | 猜官方重置时刻 | 猜出来的时刻会在每个用户身上都错一次；滚动 7 天是**能精确算出来**的量 |
| 失败用 `--danger` | 复用 `--cat-*` | 类别色已被「记录类别」占满；借去表达成败会让两个维度一起失效（tokens.css 已写明该禁令） |

## 6. 兼容与回滚

- 每个子任务都是**独立 PR**，可单独 revert。
- I4 的持久化改动是**加字段**，旧版本读到新值会忽略多余字段、退回 `none`，
  不会崩——不需要数据迁移。
- CSS 令牌只增不改，旧组件引用不受影响。
- 截图会全部失效，I5 统一重出；本轮**不合并任何**未伴随重出图的视觉 PR 到 `main`
  之后才出图的状态——即重出图与 I5 同 PR。

## 7. 验收命令

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run test:e2e
SCREENSHOTS=1 npm --prefix web run test:e2e -- screenshots.spec.ts   # 重出归档图
./scripts/gui-test.sh --build                                        # 真机取图 + 几何门禁
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```