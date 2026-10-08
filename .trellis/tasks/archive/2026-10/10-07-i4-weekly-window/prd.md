# PRD：I4 · 周用量窗口（第二条限额层）

**父任务**：`10-07-round-i-truth` · **优先级**：P1 · **依赖**：需 I3 先合（同一批文件）

## 为什么

竞品调研的第一推荐项，证据都在 URL 上：

- **Claude 的订阅已经是两层限额（5 小时滚动 + 周），而我们只做了 5 小时那一层。**
  `web/src/features/usage/planLimits.ts` 里只有一个标量 `limitTokens`；
  全仓 `grep -riE "weekly|每周|周用量" web/src` **零命中**。
- CCUM 按 👍 排的第二名就是它：
  [Maciek-roboblog/Claude-Code-Usage-Monitor#167](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/167)
  *Add Weekly Usage and Weekly Reset Day/Time*（👍13）
- CCSeva 的 README 把「weekly & 5-hour limits」直接写成头号卖点
  （[Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva)）
- 用户的第一痛是「限额来得莫名其妙」
  （[anthropics/claude-code#16157](https://github.com/anthropics/claude-code/issues/16157) 👍695）
  ——他们缺的不是又一个数字，而是**能自己验证限额去哪了的东西**。

## 核心约束：不许伪造精度

**本机日志推不出 Anthropic 的官方周重置时刻。** 因此本任务只能做两件能站住的事：

1. **滚动 7 天消耗**（`now - 7d, now]`）——**读自日志的精确值**，徽章 `logged`
2. **可选预算对照**——使用者自设、或用 preset 的估算值，徽章 `estimated`；
   按近 7 天的平均速率推算触达时刻，徽章 `inferred`

并且界面上必须有一句说明：**这是滚动 7 天，不是官方重置窗口，两者不逐分钟吻合。**

- `WeeklyWindow` **不得有 `resetAt` 字段**——我们不知道，就不给这个字段留位置
- 没选 / 没设预算时，只显示消耗，**不显示任何百分比**（沿用 5 小时卡片的既有纪律）
- 数据不足时明说「样本不足」，不外推（沿用 `MIN_SAMPLE_MS` 的既有规则）

## 需求

### 1. `planLimits` 扩成两档

```ts
type PlanSelection = {
  id: PlanId;
  limitTokens: number | null;        // 5 小时窗口
  weeklyLimitTokens: number | null;  // 滚动 7 天
};
```

- preset 的周估算值需要有来源依据；**没有可靠来源的档位就填 `null`**，
  并在标签上说明「只显示消耗」。**不许编一个看起来合理的数字。**
- **向后兼容**：旧的持久化值（只有 `id` 与 `customLimitTokens`）反序列化后
  `weeklyLimitTokens` 为 `null`，界面退回「只显示消耗」
- `parsePlanSelection` 是纯函数，兼容性必须有单测

### 2. 滚动 7 天求和

- 复用 `usageAggregations` 的既有聚合，**不新增数据源、不新增 Tauri 命令**
- 边界明确：左开右闭 `(now - 7d, now]`，且**只有带 usage 的记录**计入
- 边界条件要有单测：恰好落在 7 天前一刻的记录不计入；跨夏令时不得错位

### 3. 界面

- 位置：与 5 小时窗口并列，构成「限额」区；**不得**只是再加一张同构的卡片，
  否则 I3 刚解决的首屏问题会回来
- 呈现必须与 5 小时层**可区分**（避免两个长得一样的仪表让人分不清哪层是哪层）
- 90%–130% 字号缩放、浅/深两套主题下均无布局缺陷
- 没设预算时，界面仍然要有信息量（本任务**不得**重蹈「进度弧恒为 0 的装饰环」）

## 非目标

- **不做压缩取证**（调研 #2）：它的前提是「压缩记录在真实 JSONL 里有可识别锚点」，
  验证需要读使用者的真实会话内容，留待下一轮单独立项
- 不做常驻 CLI / statusline 集成（调研 #6，需要新增 Rust binary target，
  而打包不被 CI 覆盖，成本被系统性低估）
- 不做币种换算（调研 #5，需要联网取汇率 → 破红线）
- 不做任何形式的用量上传或排行榜

## 验收标准

- [ ] 单测：`parsePlanSelection` 对旧格式（无 `weeklyLimitTokens`）回退为 `null` ——
      **变异验证**：删掉兼容分支，测试必须红
- [ ] 单测：滚动 7 天求和的边界（左开右闭、夏令时、空数据）
- [ ] 单测：没设预算时不渲染任何百分比字符串
- [ ] 单测：`WeeklyWindow` 类型里没有 `resetAt` 这类字段
      （用测试锁住「不知道就不编」这条纪律）
- [ ] e2e：选计划 / 不选计划两种状态下，限额区的读数与说明文案都正确
- [ ] 真机取图：限额区在浅/深下各一张，**两种计划状态各一张**，维护者目验
- [ ] CHANGELOG `[Unreleased]` 有中文条目，明确写出「滚动 7 天、非官方重置窗口」

## 入手位置

- `web/src/features/usage/planLimits.ts` / `.test.ts`
- `web/src/features/usage/BillingWindowCard.tsx`（限额区重构）
- `web/src/features/usage/usageAggregations.ts`（7 天切片）
- `web/src/features/settings/ThresholdsPanel.tsx`（计划选择 UI 加第二档）
- 新增 `web/src/features/usage/weeklyWindow.ts` + `.test.ts`

## 难度

中。算法本身简单（求和 + 除法），**难在诚实**：
每一个数字都要能说清它是读来的、估的、还是推的，且不得给出我们不知道的精度。

## 备注

评审已否证「用量页 Y 轴刻度不等距」等 8 条目测结论，动手前先读
`.trellis/tasks/round-i-design-review.md` 第 5 节，别去改那些本来就是对的。