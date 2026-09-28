# 排错手册

现象（保留报错原文，方便搜索）→ 原因 → 解决。

---

## 桌面应用

### 窗口打开但内容空白

**现象**：桌面窗口打开了，界面一片空白。

**原因**：Tauri 生产形态从 `web/dist/` 加载前端。该目录是构建产物
（不入库），没有先构建前端时窗口里什么都没有。

**解决**：

```bash
npm --prefix web ci
npm --prefix web run build
cargo run --manifest-path src-tauri/Cargo.toml
```

**不该用这个方案的情况**：如果你是在开发前端（要热更新），直接用
`npm --prefix web run dev`（Vite 5173）预览，见
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)。

### 编译报 `The 'frontendDist' configuration is set to '"../web/dist"' but this path doesn't exist`

**原因**：`tauri::generate_context!()` 在**编译期**读取 `frontendDist`
指向的目录，CI 或干净环境里没有 `web/dist/` 就直接失败。

**解决**：先构建前端再跑 cargo（顺序不能反）：

```bash
npm --prefix web ci
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

CI 的 job 依赖关系已经按这个顺序编排；本地保持同样顺序即可。

### 「生成分析报告」失败，提示找不到 claude CLI

**现象**：报告生成一开始就失败，错误里列出本机实际存在的安装位置。

**原因**：GUI 应用启动时的 `PATH` 常比终端窄，`claude` CLI 装在
`~/.local/bin`、`~/Library/...` 等位置时可能找不到。应用会先 hard-probe
CLI 能否启动，失败时报出探测到的位置，而不是运行中途断掉。

**解决**：把 `claude` 安装到标准位置（如 `/usr/local/bin`、`/opt/homebrew/bin`），
或建符号链接；也可以在终端 `which claude` 确认路径后在报错信息里核对。

### 看不到「停止分析」按钮

**原因**：「停止分析」**只在报告生成过程中出现**，生成结束（成功 / 失败 /
取消）后即消失。这是预期行为，不是缺陷。

**解决**：无需处理。如果生成过程始终看不到按钮，先确认报告确实在生成中
（面板有进行中的状态提示）。

### 实时监控页面打不开 / 一直重试

**现象**：监控页显示连接失败或反复探测。

**原因**：实时监控内嵌的是**外部** cc-monitor/dashboard 服务
（默认探测 `localhost:8090`），该服务不在本仓库内，没启动就连不上。

**解决**：先另行运行你的 dashboard 服务。不需要这个功能就不开该页——
它不影响会话分析。

### macOS 首次打开提示无法验证开发者

**原因**：发布产物使用 ad-hoc 签名（没有开发者证书），Gatekeeper 会拦
第一次启动。

**解决**：右键应用 →「打开」（只需一次）；或到
「系统设置 → 隐私与安全性」放行。

---

## 构建与打包

### 打包脚本失败：`Unsupported target` 或 target 未安装

**现象**：`cargo build --target x86_64-apple-darwin` 报 target 不存在。

**原因**：交叉编译目标没有装。脚本会自动 `rustup target add`，手动执行
时需要自己装。

**解决**：

```bash
rustup target add x86_64-apple-darwin    # Intel 交叉编译（在 Apple Silicon 上）
rustup target add aarch64-apple-darwin   # Apple Silicon
```

### Windows 打包失败

**原因**：缺 Visual Studio Build Tools 或 MSVC Rust target。

**解决**：安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
（含 C++ 工作负载），然后：

```powershell
rustup target add x86_64-pc-windows-msvc
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

---

## 会话数据

### 会话列表里缺少某些会话

**原因**：列表数据来自标题缓存 `meta-cache-v2.json`（按 mtime + size
复用条目）。刚产生的会话会在下一次扫描时出现；手工改过会话文件会让
缓存失效并触发重扫。

**解决**：正常等一轮扫描即可；标题补全进度在列表顶部有显示。

### 会话很大时界面卡顿

**原因**：几十 MB 的 JSONL 全量解析与渲染会占用主线程。

**解决**：解析已按 2000 行分片让出事件循环、日志表按实测行高窗口化渲染；
如果仍感到卡，先用列表的时间分组与项目折叠缩小范围，或用日志筛选
（时长 / 类型 / 文本）缩小显示范围。持续卡顿请开 Issue 并附会话规模
（**不要附会话内容**）。

---

## 其他

以上都不是？到
[Issue 列表](https://github.com/liang-zhenxiang/cc-analyzer/issues/new/choose)
搜一下关键词，还没有就提一个 Bug 报告——附上完整的报错文本与应用版本。
