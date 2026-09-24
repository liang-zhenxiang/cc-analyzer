# CI 构建顺序说明

更新时间：2026-09-21

## 背景

CI 最初只运行了：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

但干净环境中没有 `web/dist/`。Tauri 2 在
`tauri::generate_context!()` 编译期会读取 `tauri.conf.json` 里的
`frontendDist: "../web/dist"`，因此检查直接失败，错误为：

```text
The `frontendDist` configuration is set to `"../web/dist"` but this path doesn't exist
```

这个问题只影响 CI 信号，不影响本地已构建应用的功能。

## 修复

CI 现在按下面的顺序执行：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

这样 `web/dist/` 会在 `cargo check` 之前生成。

## 本地提交前检查清单

在提交或打开 Pull Request 前，至少执行一次：

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
cargo check --manifest-path src-tauri/Cargo.toml
```

如果修改了 macOS 或 Windows 打包脚本，还要运行对应打包脚本，
并检查产物架构、签名和启动。

## 规范约定

1. 功能修改使用功能分支；合并到 `main` 走 Pull Request。
2. Commit message 使用 Conventional Commits，例如 `ci:`、`fix:`、`feat:`、`docs:`。
3. PR 必须等待 CI 绿色后再合并。
4. `web/dist/` 和 `node_modules/` 是生成产物，不要提交。
5. 修改 `src-tauri/tauri.conf.json` 中的 `frontendDist` 时，必须同步检查 CI 和打包脚本。

## 常见问题

如果再次看到 `frontendDist ... path doesn't exist`，先确认：

1. 是否在 `cargo check` 前执行了 `npm --prefix web run build`；
2. `.github/workflows/ci.yml` 是否仍包含 web install、test、build 步骤；
3. `web/dist/index.html` 是否确实存在；
4. `src-tauri/tauri.conf.json` 的 `frontendDist` 是否仍指向 `../web/dist`。
