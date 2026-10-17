# 高对比度：两条既有进度条填充边界不可读

## Goal

修掉 .weeklyBarTrack / .attributionBarTrack 在高对比度下填充与轨道塌缩（1.19/1.27）：HC 轨道底换 --bg-inset + 1px 描边，归因余项补内描边；顺带把页头 .progress 的 4.38 提到 --text-secondary。

## Requirements

- 高对比度浅色与深色两档下，`.weeklyBarTrack` 和 `.attributionBarTrack`
  的填充与轨道对比度必须达到图形元素的 3:1 门槛；当前分别只有 1.19 / 1.27。
- 高对比度下两条轨道改用 `--bg-inset` 作底色，并以
  `box-shadow: 0 0 0 1px var(--border-strong)` 画外描边。不得使用 `outline`，
  避免触发焦点环字面量守卫。
- `.attributionRestFill` 合并值使用 `--chart-1-soft`；高对比度下必须补
  `box-shadow: inset 0 0 0 1px var(--border-strong)`，不能只修轨道底色。
- 普通对比度保持现有语义、尺寸与交互，不新增颜色令牌。
- 页头 `.progress` 从 `--text-tertiary` 提到 `--text-secondary`：前者叠在
  普通浅色页底上只有 4.38，低于正文 4.5 门槛。
- 用户可感知变化写入 `CHANGELOG.md` 的 `[Unreleased] / Changed`。

## Acceptance Criteria

- [ ] 组件测试锁定 HC 两条轨道与归因余项的计算样式规则。
- [ ] 双引擎 e2e 在 HC 浅色与深色下读到对应计算色与描边，证明生产 bundle
      的层叠真的生效。
- [ ] `.progress` 的静态守卫锁定 `--text-secondary`。
- [ ] `npm --prefix web test -- --maxWorkers 4`、`npm --prefix web run build`、
      `./scripts/lint.sh` 通过。
- [ ] 重出受影响的用量页浅色 / 深色 × Chromium / WebKit 截图，并人工查看
      HC 两条进度条填充边界可辨；`./scripts/check-screenshots.sh` 通过。

## Notes

- 本条为轻量任务，PRD 足以承载需求与验收。
- 普通档填充分别约为 3.84 / 5.53，不在此 issue 的回归范围内；高对比度轨道
  改用 `--bg-inset` 后，填充对轨道浅色为 6.90、深色为 9.97。
