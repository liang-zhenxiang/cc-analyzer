# 发布说明全中文并沉淀规范

## Goal

Release 发布说明目前是三段拼装（AI 中文摘要 + CHANGELOG 手写段 +
GitHub 原生变更清单）。第三段由 `releases/generate-notes` 生成，**自带英文
模板串**：`## What's Changed`、`## New Contributors`、
`**Full Changelog**: ...`。用户要求发布说明全中文。

## Requirements

1. 发布说明中**不再出现英文模板串**，至少要覆盖：
   - `What's Changed` → 中文标题
   - `New Contributors` → 中文标题
   - `Full Changelog` → 中文
   - 贡献者行的 `by @user in <url>` 句式
2. 分类标题（`### Features` / `### Bug Fixes` 之类）用**中文**，
   通过仓库级 `.github/release.yml` 配置提供，而不是靠后处理猜。
3. **降级行为必须保持**：拿不到 PR 清单、没有上一个 tag、没有 API Key
   时，发布流程都不能中断（这是既有的三段式独立降级设计，不许破坏）。
4. 转换逻辑必须**可测**：不能只写在 `release.yml` 的内联 `run:` 里
   让人工肉眼确认。抽成 `scripts/` 下的脚本，配夹具做单元测试。
5. 「发布说明必须中文」写入 `.trellis/spec/guides/`，并在分工表里登记，
   以后新增段落默认中文。

## Acceptance Criteria

- [ ] 存在仓库级 `.github/release.yml`，分类标题为中文
- [ ] `.github/workflows/release.yml` 调用新的转换脚本（或等价的可测单元），
      `run:` 与脚本之间只通过 `env:` 传参，不内联 `${{ }}`
- [ ] 新增脚本有单元测试，夹具覆盖：典型 PR 清单、含 `New Contributors`、
      只有对比链接、空输入、已是中文的输入（幂等）
- [ ] 空输入 / 缺段时脚本输出为空且退出码为 0（降级不阻断）
- [ ] `./scripts/lint.sh` 全绿（含 shellcheck / actionlint / zizmor 基线 0）
- [ ] `.trellis/spec/guides/` 中有「发布说明必须中文」的权威条款，
      且 `docs/MAINTAINER_GUIDE.md` 以**引用**（非复制）方式指向它

## Notes

- 用户可见文案面向中文用户，README 有中英双份，但**发布说明只做中文**——
  这是维护者的明确选择，不要自作主张加英文版。
- 不要用「先英文生成再让 AI 翻译」的链路：AI 摘要那步已经是可选的，
  把语言正确性押在它身上会让没配 API Key 的发布退回英文。

## 关联

- GitHub Issue: #52（`docs(release): 发布说明全中文化`）
