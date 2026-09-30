# 本地开发启动指南

更新时间：2026-09-30

本项目前端源码位于 `web/`，使用 React、TypeScript 和 Vite。仓库根目录还有一个
私有的 `package.json`，它只管构建工具链（提供 Tauri CLI），不参与前端运行时。

## 环境要求

- Rust 1.77 或更高版本
- Xcode Command Line Tools（macOS）
- Node.js 和 npm，用于构建或开发 Web UI
- 可选：本机安装 `claude` CLI，用于“生成分析报告”
- 可选：本机 `localhost:8090` 运行外部 cc-monitor/dashboard，用于“实时监控”

## 启动桌面应用

在仓库根目录执行：

```bash
cargo run --manifest-path src-tauri/Cargo.toml
```

首次运行会编译 Rust 和 Tauri 依赖。编译完成后，会打开
“CC Analyzer”桌面窗口。

## 开发 Web UI

```bash
cd web
npm install
npm run dev
```

Vite 开发服务器默认监听 `http://127.0.0.1:5173`。生产 Tauri 应用读取
`web/dist/`，修改前端源码后需要执行 `npm run build` 再启动桌面应用。

## 「看不到停止分析」排查

「停止分析」只在报告生成过程中出现，生成结束（成功/失败/取消）后即消失，这是预期行为。

如果生成报告时始终看不到「停止分析」，常见原因：

1. 改了前端源码但没有重新构建 `web/dist/`：Tauri 读取的是 `tauri.conf.json` 里的
   `frontendDist: "../web/dist"`；
2. 机器上还开着旧的 App 实例，新窗口被盖住（旧实例可用菜单「文件 → 退出」关掉）；
3. 桌面应用没有重新编译，跑的仍是上一次构建的产物。

正确的启动顺序（`web/dist` 变化会触发 Rust crate 重编并重新嵌入前端，实测
`touch web/dist/index.html` 后 `cargo build` 会重新编译，所以不用担心「嵌入缓存」）：

```bash
npm --prefix web run build                        # 先把 React 前端产出到 web/dist
cargo run --manifest-path src-tauri/Cargo.toml    # 再启动桌面应用
```

想只调前端样式时可以用 `npm --prefix web run dev`（Vite 5173）配合浏览器/桩 IPC
预览；仓库目前没有配置 Tauri 的 `devUrl`，所以桌面端日常就用「build + cargo run」。

## 常用检查

提交或打开 Pull Request 前，执行与 CI 相同的检查：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

详细说明见 [CI.md](CI.md)。

执行 release 构建（只编译二进制，不打 bundle）：

```bash
cargo build --release --manifest-path src-tauri/Cargo.toml
```

构建生产前端（根 `package.json` 的 `build` 脚本转发到 `web/`）：

```bash
npm run build
# 等价于 npm --prefix web run build（依赖仍需先 npm --prefix web ci）
```

打各平台的发布产物走 Tauri 官方打包流程，脚本会自动装好依赖再调 `tauri build`：

```bash
npm run build:macos:arm64    # dist-arm64/CC Analyzer.app + CC-Analyzer_<版本>_aarch64.dmg
npm run build:macos:intel    # dist-intel/CC Analyzer.app + CC-Analyzer_<版本>_x64.dmg
npm run build:windows        # dist-windows/ NSIS 安装程序 + CC_Analyzer_x64_portable.zip
```

## 开发注意事项

- 后端 Rust 代码修改后，需要重新执行 `cargo run`。
- `web/` 是前端源码，生产构建输出到 `web/dist/`。
- 会话分析读取 `~/.claude/projects`。
- “生成分析报告”依赖本机 `claude` CLI。
- “实时监控”页面依赖外部 `localhost:8090` 服务；该服务不在本仓库内。
- 会话数据可能包含代码、路径、命令输出和敏感信息；“生成分析报告”会把结构化摘要交给本机
  `claude` CLI，请注意其后续模型/服务流向。

## 可选：使用 Tauri CLI

Tauri CLI 由根 `package.json` 的 devDependency（`@tauri-apps/cli`）提供，
版本由 `package-lock.json` 锁定——跑一次 `npm install` 即可，**不需要**
全局 `cargo install tauri-cli`。装好后可以经根脚本调用：

```bash
npm install            # 装好根工具链
npm run tauri -- dev
```

当前项目也可以直接用 `cargo run` 启动。若要用 Tauri 的开发服务器集成，
可先构建生产前端：

```bash
npm --prefix web run build
npm run tauri -- dev
```

## 相关设计文档

- [`CI.md`](CI.md)：CI 构建顺序和常见问题。
