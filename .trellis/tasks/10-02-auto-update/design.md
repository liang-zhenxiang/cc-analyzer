# 技术设计：双渠道自动更新

> 对应 prd.md · 依赖 tauri-plugin-updater（Tauri 2 官方更新器）

## 1. 渠道与更新源

| 渠道 | 版本形态 | 更新源（固定 URL） |
| --- | --- | --- |
| beta | `vX.Y.Z-beta.N`（prerelease） | `releases/download/beta/latest-beta.json`（rolling release `beta`） |
| stable | `vX.Y.Z` | `releases/download/stable/latest-stable.json`（rolling release `stable`） |

rolling release：固定 tag 名（`beta` / `stable`），每次发版删旧建新，资产 URL 恒定。
GitHub 没有「最新 prerelease」别名，rolling tag 是社区通行解法。`v*` 正常 tag
与 rolling tag 命名空间不冲突。

## 2. 签名

- `npx tauri signer generate` 生成 minisign 密钥对（密码随机）。
- 公钥 → `tauri.conf.json` `plugins.updater.pubkey`（入仓，可公开）。
- 私钥+密码 → GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` /
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（gh secret set 写入，不落盘）。
- 构建：`bundle.createUpdaterArtifacts: true` + 环境变量签名 → 产物 `.sig`。

## 3. Rust 侧

- 新依赖：`tauri-plugin-updater`、`tauri-plugin-process`（重启）。
- 渠道是运行时状态（设置里选），updater 的 endpoint 不能写死在 conf——
  用 `UpdaterBuilder` 动态拼：
  ```rust
  #[tauri::command]
  async fn check_updates(app: tauri::AppHandle, channel: String)
    -> Result<UpdateInfoJson, String>   // 序列化为前端友好的 DTO
  ```
  channel ∈ {stable, beta} → endpoint URL；非法 channel 回错。
- `download_and_install(app, channel)`：check 后 `update.download_and_install()`，
  完成后由前端调 `relaunch`（process 插件）。
- capabilities：`updater:default`、`process:allow-restart`（PR 里说明为何新增）。
- `app_version()` 命令：`app.package_info().version` 回传。

## 4. 前端

- `web/src/api/types.ts`：`UpdaterBridge { appVersion(); checkUpdates(channel): Promise<UpdateCheck>; installUpdate(channel): Promise<void>; relaunch(): Promise<void> }`，
  `UpdateCheck = { available: false; current: string } | { available: true; current: string; version: string; notes: string; install: () => Promise<void> }`
  ——install 由桥封装（Rust 侧缓存的 update 句柄）。
- `features/settings/updateChannel.ts`：渠道存储（`cca-update-channel`，
  stable 默认，不可信输入回退 stable）+ `channelEndpointOf` 纯函数（供单测）。
- ThresholdsPanel 增「软件更新」区：当前版本、渠道 select、「启动时自动检查」
  checkbox（默认开，`cca-update-autocheck`）、立即检查按钮 + 两态结果 +
  安装并重启。
- 启动静默检查：AppShell 挂载后若 autocheck 开 → 检查 → 通知（复用 StatusToast
  通知机制）；失败静默（不打扰）。
- e2e：tauri-mock 增 updater mock（两态可切换），断言设置区与渠道持久化。

## 5. CI

- `beta.yml`（push tags `v*-beta.*`）：复用 release.yml 的构建矩阵
  （三平台、签名、createUpdaterArtifacts）→ prerelease + sig 资产 →
  生成 `latest-beta.json`（platforms 键指向**该 prerelease 的资产 URL**，
  签名从 .sig 读入 JSON）→ 删建 rolling release `beta` 挂 JSON。
- `promote-stable.yml`（workflow_dispatch，inputs: `beta_tag`）：
  1) 校验 beta_tag 存在且为 prerelease；2) checkout 该提交；
  3) lint+test 全量 job 绿才继续；4) 版本号三处同步 X.Y.Z + Cargo.lock；
  5) 构建矩阵 → release vX.Y.Z + sig + `latest-stable.json` + rolling `stable`；
  6) 从晋升提交开 `chore/promote-vX.Y.Z` PR 回 main（版本同步）。
- `release.yml`（现有，手动 vX.Y.Z tag 兜底）：追加与晋升相同的三件事
  （sig 已有、latest-stable.json、rolling stable），逻辑与 beta.yml 共享
  via composite action？——两份 workflow 各自内联（本项目 YAML 以直白为先，
  共享 action 收益小于间接层成本），但 JSON 生成脚本抽成
  `scripts/make-updater-json.sh` 一份。
- 红线复核：`persist-credentials: false`、无缓存、`${{ }}` 经 env、
  pull_request_target 不出现。

## 6. 测试

- 单测：`updateChannel.ts`（默认/回退/端点映射）、make-updater-json 的
  shell 自测进 lint.sh？——脚本做纯输出，CI 里用夹具比对（轻量 job）。
- Rust：`check_updates` 的 channel→URL 映射单测（纯函数抽出）。
- e2e：设置更新区渲染、渠道切换持久化、mock 检查两态、安装按钮出现条件。
- GUI：真机启动（静默检查在无更新源时不崩）、设置区截图。
- **端到端实跑**：本收尾轮真发 `v0.9.0-beta.1` 走通 beta 链路；
  稳定晋升留给维护者首次实操（或由 AI 代跑一次 v0.9.0 验证）。

## 7. 回滚

- 更新器检查失败不影响应用（全部 try-catch，UI 显式错误）。
- 流水线独立新增，不改既有发布语义；出问题删 workflow 即回原状。
