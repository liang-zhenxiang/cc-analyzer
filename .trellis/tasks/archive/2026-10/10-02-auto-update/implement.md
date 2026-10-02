# 执行计划：双渠道自动更新

## 步骤

1. [ ] 密钥：`tauri signer generate`；公钥入 conf；私钥/密码 `gh secret set`
2. [ ] Rust：updater + process 插件、`check_updates` / `install_update` /
       `app_version` 命令、capability、channel→endpoint 纯函数 + 单测
3. [ ] 前端：updateChannel.ts + 单测；UpdaterBridge + tauri 实现与 mock；
       设置「软件更新」区；启动静默检查 + 通知
4. [ ] `scripts/make-updater-json.sh`（JSON 生成，bash 硬规则）
5. [ ] `beta.yml`；本地 `./scripts/lint.sh` 全绿
6. [ ] `promote-stable.yml`；release.yml 追加稳定渠道三件套
7. [ ] e2e：更新区两态 + 渠道持久化（tauri-mock 扩展）
8. [ ] GUI 真机：启动无更新源不崩 + 设置区截图
9. [ ] 全量回归 + CHANGELOG + SECURITY/USAGE/MAINTAINER_GUIDE 文档
10. [ ] 实发 `v0.9.0-beta.1` 验证 beta 链路；给用户写「如何发稳定版」操作卡

## 验收门

prd.md 验收全勾；真机截图亲眼看；两个 workflow 至少 beta 实跑成功一次
