# 退出浮窗后恢复进入前的主窗口几何

## Goal

修复 `float` 插件退出浮窗后主窗口内容区比进入前高 28px 的几何记账偏差，并让真机
门禁直接锁定进入前与退出后的 viewport 一致。

## 现象

真机门禁稳定复现：

- 进入浮窗前：`1400×872`
- 进入浮窗后：`420×620`
- 退出浮窗后：`1400×900`

`tauri.conf.json` 的 `height: 900` 是含 macOS 标题栏的窗口高度；页面 viewport
读到的是 872px 内容区。退出后多出的 28px 恰好是一个标题栏。

## Requirements

- 进入浮窗时必须可靠记录恢复所需的主窗口内容区尺寸；记录失败不得静默落入
  硬编码尺寸兜底。
- 退出浮窗时必须恢复进入前的内容区尺寸，而不是配置文件中的外框尺寸。
- 恢复顺序必须与重新启用窗口装饰、恢复最小尺寸协调，不能依赖偶然的事件顺序。
- 真机门禁记录进入前、浮窗中、退出后的 viewport，并断言进入前与退出后逐像素相等。
- 用户可见修复写入 `CHANGELOG.md` 的 `[Unreleased] / Fixed`。
- 不新增 Tauri 权限、不扩大 capability、不引入新依赖。

## Acceptance Criteria

- [ ] 在临时诊断构建中读到 `enter` 实际记录的尺寸，确认根因而非仅按 28px 症状修补。
- [ ] 修复后真机门禁读数为 `1400×872 → 420×620 → 1400×872`，不是只断言细头/顶栏。
- [ ] 退出浮窗的尺寸断言在修复前能红、修复后能绿。
- [ ] `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、
      `cargo check`、`cargo test` 通过。
- [ ] `./scripts/gui-test.sh --build` 通过，且日志中的浮窗三步 viewport 可核对。
- [ ] `./scripts/lint.sh` 通过；本机 Docker 不可用时用等价本机 zizmor 复核并记录。

## Notes

- `tauri` 的 `set_size` 在 macOS/tao 最终走 `setContentSize`，与 `inner_size()`
  属于同一内容区口径；因此不能用“改成 outer_size”当作未经证实的修复。
- 真机探针只收集事实，阈值和相等断言留在 `scripts/gui-test.sh`。
