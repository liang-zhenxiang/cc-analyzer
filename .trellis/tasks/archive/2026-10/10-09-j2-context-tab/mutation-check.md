# J2 变异验证记录

> 方法：对实现做定向破坏（改坏 → 跑测试 → 期望变红 → 还原 → 复绿）。
> 每条记录破坏点、被抓住的用例与失败信息，证明断言不是恒真。

## 变异 1：删掉降采样的「断崖强制保留」

- **破坏点**：`web/src/features/sessions/contextCurve.ts` 的 `downsampleCurve`
  里删去把 `forced` 索引并入 kept 集合的循环（朴素分桶 min/max 保留仍在）。
- **期望**：分桶会丢掉既不是桶内最小也不是最大的断崖边缘点，把断崖磨圆。
- **结果**：`contextCurve.test.ts` 变红——
  `× forces the cliff edges to survive bucketing that would drop them`（1 failed / 14 passed）。
- **还原后**：15/15 复绿。

## 变异 2：删掉被丢清单的「仅用户」过滤

- **破坏点**：`web/src/features/sessions/DroppedList.tsx` 里 `shown` 的
  `mode === "user"` 分支删去，过滤档形同虚设（清单恒为全量）。
- **期望**：切「仅用户」后行数与徽标不再收窄。
- **结果**：`ContextView.test.tsx` 变红——
  `× 被丢清单「仅用户」过滤收窄行集`（1 failed / 7 passed）。
- **还原后**：8/8 复绿。

## 结论

两条变异都被各自的用例当场抓住，断言具备发现真实回归的能力。
