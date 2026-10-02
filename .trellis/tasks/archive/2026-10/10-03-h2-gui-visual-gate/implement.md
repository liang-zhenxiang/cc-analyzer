# 实施计划：H2 真机截图视觉门禁

> 依赖 PRD：[`prd.md`](./prd.md) · 分支建议：`feat/gui-visual-gate`
> **前置**：H1 的修复已合并（它就是本门禁的第一个被测对象；没有它就没有「修好」的对照）

## 0. 环境与基线

```bash
./scripts/gui-test.sh --build        # 先确认今天这条链路是通的，记录输出
cat gui-artifacts/app-window.png     # 目验当前真机默认视图
```

先把「今天的通过状态」存档，后面变异验证要跟它对比。

## 1. Rust 侧：几何探针

文件：`src-tauri/src/lib.rs` 的 `gui_capture` 模块。

1. 读 `CCA_GUI_PROBE`；空值视同未设。
2. 在取图**之后**（同一线程、同一次启动）求值探针脚本：
   - 用 `WKWebView` 的 `evaluateJavaScript:completionHandler:`。既有代码已经通过
     `webview.with_webview(|platform| ...)` 拿到裸 `WKWebView` 指针（`capture()` 的做法），
     照抄那条路径即可。**不要用 `webview.eval`**——它拿不回返回值。
   - completion handler 里把返回的字符串（JSON）写入 `CCA_GUI_PROBE` 指定的路径。失败只打日志、不 panic
     （与 `capture()` 同一条纪律：这是取证旁路，不能拖垮应用）。
3. 探针 JS 只收集**事实**，形如：

```json
{
  "viewport": { "width": 1400, "height": 872 },
  "document": { "scrollWidth": 1400, "clientWidth": 1400 },
  "elements": [
    { "selector": "[data-probe='gauge']", "rect": {"x":0,"y":0,"width":0,"height":0}, "clipped": false }
  ],
  "tables": [
    { "selector": "...", "clientWidth": 0, "scrollWidth": 0, "lastColumnRight": 0, "containerRight": 0 }
  ]
}
```

   - 选择器优先用**语义锚点**（`role`、`aria-label`、`data-probe`）。若当前 DOM 缺少稳定锚点，
     可以给组件加 `data-probe="gauge"` 这类**仅用于探测**的属性——但优先复用既有
     `aria-label`（如 `Gauge` 的 `ariaLabel`），避免为测试污染 DOM。
   - 阈值与判定**不写进这个脚本**。

## 2. 多视图取图

1. `CCA_GUI_CAPTURE_TAB` 改为按 `,` 切分，依次：点击 → 等 `TAB_SETTLE_MS` → 取图。
   输出文件名规则：第一张 `foo.pdf`，第 N 个标签页 `foo-<slug>.pdf`
   （slug 由标签名安全化得到；**单个值的旧文件名 `foo-tab.pdf` 保持兼容**，
   否则会静默破坏既有脚本与文档）。
2. 每张之间要等前一张**落盘**再点下一个（既有 `wait_for_file` 就是为此写的，
   第一张的那个坑对第 N 张同样成立）。

## 3. 脚本侧：判定

文件：`scripts/gui-test.sh`。

1. 新增一个 `python3` heredoc 读取探针 JSON（沿用既有「用 python3 而非 jq」的取舍，
   理由已在 gui-tests.md 写明）。
2. 断言（每条都用 `step`/`ok`/`bad`，并**打印实际数值**，例如
   `表盘 140px ≤ 200px，且完全落在卡片内`）：
   - 无横向溢出：`document.scrollWidth <= clientWidth + 1`
   - 表盘有界：宽度 ≤ 阈值 **且** 其矩形完全包含在所属卡片矩形内
   - 表格末列可达：末列右边界 ≤ 容器右边界，或容器可横向滚动
   - 视图覆盖：约定的视图清单逐一存在
3. 每个标签页产物都走既有「转 PNG + 非空白」流水线；缺一张即 `bad`。
4. 记得把探针路径与多标签清单在脚本头部的「用法」段与 `--help` 字面量里都写上
   （两处重复是既有的有意取舍，改一处要改两处——注释里有说明）。

## 4. 变异验证（**本任务的核心交付证据**）

依次做三次，每次都记录「改了什么 → 断言如何失败 → 还原后通过」：

1. **表盘拉伸**：把 `Gauge` 改回复用 `.chart`（或临时给 `.gauge` 加 `width: 100%`）。
   预期：表盘宽度断言失败。
2. **横向溢出**：临时给某个容器加一个超宽固定元素（或把 `min-width: 0` 去掉）。
   预期：`scrollWidth` 断言失败。
3. **末列裁切**：临时给记录表设一个大于容器的固定 `min-width` 且去掉滚动。
   预期：末列可达性断言失败。

> 三次都必须**真机实跑**（`./scripts/gui-test.sh --build`），不是推理。
> 输出存进任务目录的 `notes/`（或 PR 描述），这是「门禁真的会拦住」的证据。

## 5. 文档纠正

- `.trellis/spec/testing/index.md` 三层表：把 GUI 层「抓不到界面细节」改为
  它能判定的内容（**真机窗口尺寸下的布局不变量**），并注明「取图走 WebKit 自渲染，不需要屏幕权限」。
- `.trellis/spec/testing/gui-tests.md`：新增探针机制说明、多标签用法、
  「**事实在应用、断言在脚本**」的分工与理由、变异验证的要求。

## 6. 验收与提交

```bash
./scripts/lint.sh
./scripts/gui-test.sh --build
npm --prefix web test && npm --prefix web run test:e2e   # 确认没误伤
```

- 分支 `feat/gui-visual-gate`，提交信息 `feat(gui-test): 真机几何探针与多视图取图，布局回归自动失败`。
- CHANGELOG `[Unreleased] → Added` 中文条目。

## 回滚点

- 步骤 1、2（Rust）与步骤 3（脚本）相互独立：探针加了但脚本不判，行为不变（只是多写一个文件）；
  多标签不设时与今天完全一致。任一步出问题都可单独回退。
- 若探针在 WKWebView 上遇到 API 层面的坑（回调不触发、类型转换失败），
  **先如实记录再决定**——不要为了赶进度改成「用 eval 打 console 再抓日志」这种脆弱方案，
  那会把判定逻辑绑死在日志格式上。宁可缩小范围（先只做多视图取图 + 非空白判定）也要保持可靠。