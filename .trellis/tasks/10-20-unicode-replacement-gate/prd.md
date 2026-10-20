# U+FFFD 门禁与存量乱码清理

## Goal

新增扫描已跟踪文本文件工作区的 U+FFFD 门禁及自测，并清掉本次接手时实际存在的
22 个文件中的 77 处存量乱码（Issue #208 的 25 文件 / 80 处计数已经漂移）。

## Requirements

- 门禁必须扫描**已跟踪文本文件的工作区内容**，不能只扫 staged/committed，也不能漏掉未提交编辑。
- 以 `git ls-files -z` 取得文件集，并用二进制扩展名与 NUL 字节双重排除图片等二进制文件。
- 检查命中时必须输出文件路径、行号与命中次数，并返回非零退出码。
- 检查脚本必须支持 `--root <dir>`，供自测在临时 Git 仓库中构造正反例。
- 自测至少覆盖：干净文本通过、注入 U+FFFD 失败、PNG/二进制不误报、
  工作区未暂存修改能被发现。
- `scripts/lint.sh` 必须调用检查脚本；CI 的 `lint-selftest` 必须运行自测。
- 清理现有全部已跟踪文本文件中的 U+FFFD；`round-x-screenshot-verdict.md`
  的坏字节证据改写为 `\uFFFD` 转义，不增加永久豁免。
- 不修改版本号，不生成产物，不新增依赖。
- 用户不可见的工具链修复记录到 `[Unreleased] / Fixed`。

## Acceptance Criteria

- [ ] 在临时文本文件注入 `U+FFFD` 时，检查脚本与 `./scripts/lint.sh` 均失败，
      错误信息指出具体文件与行号。
- [ ] 注入应被发现的未暂存修改能触发失败；纯 PNG 二进制不触发。
- [ ] 全仓 `git ls-files` 文本文件 U+FFFD 计数为 0。
- [ ] `scripts/check-unicode-replacement-test.sh` 自测全部通过并接入 CI。
- [ ] `./scripts/lint.sh`、前端全量测试与构建、Rust 四件套通过。
- [ ] 编辑后 U+FFFD 扫描为 0，且清理没有改变代码行为。

## Notes

- 这是轻量任务，PRD 足以承载需求与验收。
- 检查只覆盖 U+FFFD；合法但错误的编码乱码不在本次范围。
