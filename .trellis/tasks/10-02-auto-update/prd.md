# PRD：双渠道自动更新

> 创建于 2026-10-02 · 用户目标原文见会话
> 一句话：**beta 渠道 AI 全自动发版，稳定版维护者一键晋升，应用内可选渠道。**

## 用户故事

- 作为 AI 维护者：每轮功能合并后推一个 `vX.Y.Z-beta.N` tag，流水线自动构建三平台、
  签名、发 prerelease、更新 beta 渠道的更新源——beta 用户随即收到更新。
- 作为人类维护者：试用若干 beta 后觉得某个好，**在 Actions 页面填一次表单**
  （或一条 gh 命令）触发晋升：该 beta 的确切代码被构建成稳定版 vX.Y.Z、发布、
  更新稳定渠道更新源——稳定用户收到更新。不需要我手工改版本号或改 CHANGELOG。
- 作为普通用户：应用默认走稳定渠道；在设置里可切到 beta；「立即检查」或启动时的
  静默检查发现新版后，一键「安装并重启」。
- 作为隐私敏感用户：更新检查只是一次对 GitHub 发布页的 GET，不上传任何数据
  ——这一点写进 SECURITY.md。

## 功能需求

1. **签名体系**：tauri updater minisign 密钥对；公钥进应用，私钥进 GitHub Secrets；
   产物带 `.sig`，客户端强校验。
2. **beta 流水线**（`beta.yml`，tag `v*-beta.*` 触发）：三平台构建 → prerelease
   （产物 + sig）→ 重建 rolling release `beta` 并挂 `latest-beta.json`。
3. **稳定晋升流水线**（`promote-stable.yml`，workflow_dispatch，输入 `beta_tag`）：
   先跑全量检查（lint/test）→ checkout 该 beta 提交 → 版本号同步为 X.Y.Z →
   构建发布 vX.Y.Z（产物 + sig + `latest-stable.json`）→ 重建 rolling release
   `stable` → 自动开「版本同步」PR 回 main。**用户唯一要做的就是填表单跑一次。**
4. **应用内更新**：
   - 设置新增「软件更新」区：当前版本、渠道（stable 默认 / beta）、立即检查、
     检查结果与「安装并重启」
   - 启动时静默检查一次（可在设置关闭）；发现新版发应用通知
   - 更新失败给可读错误，不影响正常使用
5. **渠道切换即时生效**：改渠道后下次检查即用新渠道的更新源。

## 约束

- 更新检查 = 对 `releases/download/<channel>/latest-*.json` 的一次 GET，
  无遥测、无数据上行；默认渠道 stable；beta 必须显式选择
- 晋升流水线不得绕过质量门禁（先全量检查再构建发布）
- 现有 release.yml（手动 vX.Y.Z tag）保留为兜底，行为与晋升一致
- 供应链红线全部适用（SHA pin、persist-credentials false、无缓存路径）

## 验收标准

- [ ] 密钥已生成，公钥入仓、私钥入 Secrets，`.gitignore` 无泄露
- [ ] beta.yml 实跑一次成功：prerelease 带 sig，rolling beta 的 JSON 可被
      updater 语义消费（URL 固定不变）
- [ ] promote-stable.yml 实跑一次成功：产物 + latest-stable.json + 同步 PR
- [ ] 应用内：渠道切换持久化；mock 检查的「已是最新 / 发现新版」两态可测
- [ ] 单测（渠道与版本辅助逻辑）+ e2e（设置更新区）+ GUI 真机全绿
- [ ] MAINTAINER_GUIDE 写清「如何发一个稳定版」（用户明确要求）
- [ ] SECURITY.md 增补更新检查的网络行为说明；CHANGELOG 中文条目
