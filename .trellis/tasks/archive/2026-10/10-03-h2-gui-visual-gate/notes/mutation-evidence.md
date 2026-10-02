# 变异验证证据：真机几何门禁真的会拦住布局回归

> 三次真机实跑（`./scripts/gui-test.sh --build`），每次都是「改坏 → 门禁失败并指出是哪条
> 不变量 → 还原 → 通过」。全部为**真机**运行，不是推理。
> 每条 BAD 都以实测数值命名不变量，出问题时能直接看到「破了哪条、差多少」。

## 基线（还原全部改动后的最终实跑）

- 命令：`./scripts/gui-test.sh --build`
- 结果：`通过 38 · 失败 0 · 跳过 0` → `✓ 真机 GUI 冒烟测试通过。`

---

## 变异 1：表盘改回会被拉伸的写法

- 改了什么：`web/src/features/usage/charts/Gauge.module.css` 的 `.gauge` 由
  `width: var(--gauge-size); height: var(--gauge-size)` 改回 `width: 100%; height: auto`
  （即当初复用 `.chart` 会被撑爆的写法）。
- 预期：表盘宽度断言失败。
- 实际输出：

```
✗ 用量总览：表盘失界（宽度 1030px，阈值 200px，含于卡片=True）
通过 37 · 失败 1 · 跳过 0
```

- 判读：宽度 1030px 与 H1 记录的历史缺陷（约 1020–1030px）一致；「含于卡片=True」说明
  光靠「是否超卡片」抓不住这个缺陷，**宽度上界**才是主判据。

## 变异 2：人为制造横向溢出

- 改了什么：`web/src/features/usage/BillingWindowCard.module.css` 的 `.card` 临时加
  `min-width: 2400px`。
- 预期：`scrollWidth` 断言失败。
- 实际输出：

```
✗ 用量总览：主内容区横向溢出（main scrollWidth 2572 > clientWidth 1400，overflowX=auto）
通过 37 · 失败 1 · 跳过 0
```

- 判读：文档级 `scrollWidth` 在这里是恒真的（外壳 `overflow: hidden` 把溢出挡在文档之外），
  真正抓到的是 `<main>`；这一条正是为此加的。

## 变异 3：记录表末列裁切

- 改了什么：`web/src/features/sessions/LogView.module.css` 的 `.container` 由
  `overflow: auto` 改为 `overflow: hidden`，并给 `.container table` 加 `min-width: 2400px`。
- 预期：末列可达性断言失败。
- 实际输出：

```
✗ /repo/demo：记录表末列被裁切（末列右边界 2729.0625，容器右边界 1388，overflowX=hidden，可滚动=False，提示=True）
✗ 日志视图：记录表末列被裁切（末列右边界 2729.0625，容器右边界 1388，overflowX=hidden，可滚动=False，提示=True）
通过 36 · 失败 2 · 跳过 0
```

- 判读：注意 `提示=True`——`ScrollArea` 仍渲染了滚动提示，但容器 `overflow-x` 是 `hidden`、
  实际不可滚，所以门禁正确地**不把「有提示」当成「可达」**。判据取的是「末列右边界是否落在
  容器内 **或** 容器真的可横向滚动」，而不是「有没有滚动提示」。

## 还原

三次改动均已逐字还原；`git diff` 对三个被改文件为空，最终实跑为 `通过 38 · 失败 0`。

---

# 追加：中断清理（进程泄漏）修复的自测

> 验收追加问题：`gui-test.sh` 只挂 `EXIT` trap，被 Ctrl-C（INT）或调用方 / agent 中断
> （TERM）时走不到 `cleanup()`，后台 app 会泄漏成 PPID=1 的孤儿实例。

- 修法：`trap cleanup EXIT` + `trap 'exit 130' INT` / `'exit 143' TERM` / `'exit 129' HUP`
  ——信号处理器只 `exit`，清理统一由 EXIT trap 走一遍。清理仍**只杀本轮记录的 PID**
  （绝不 `pkill -f "CC Analyzer"` 宽匹配）。
- 自测：`scripts/gui-test-shutdown-test.sh`（已接进 CI 的 `gui-test-shutdown` job）。
  它造一个假 .app，真启动 `gui-test.sh`，只给脚本本身发 TERM/INT，断言那个假 app 子进程
  被收掉。

### 自测实际输出（修复后）

```
gui-test.sh 中断清理自测
  ✓ SIGTERM：gui-test.sh 收到 TERM 后，后台 app 进程（PID 40797）被 cleanup 收掉
  ✓ SIGINT：gui-test.sh 收到 INT 后，后台 app 进程（PID 40814）被 cleanup 收掉

通过 2 · 失败 0
✓ gui-test.sh 中断清理自测通过
```

### 自测自身的变异（证明它真会红）

- 改了什么：把 `gui-test.sh` 的 trap 临时改回**只挂 EXIT**（模拟修复前）。
- 实际输出：

```
gui-test.sh 中断清理自测
  ✓ SIGTERM：gui-test.sh 收到 TERM 后，后台 app 进程（PID 34217）被 cleanup 收掉
  ✗ SIGINT：后台 app 进程（PID 34342）在 INT 后仍存活——泄漏未清理

通过 1 · 失败 1
```

- 判读：只挂 EXIT 时 SIGINT 用例确实红——自测不是恒真。还原 trap 后重新全绿，且
  `pgrep -fl "dist-arm64/CC Analyzer.app"` 无残留。SIGTERM 用例在变异下仍绿，是因为
  bash 对未捕获 SIGTERM 仍会执行 EXIT trap；真正会漏的是 INT/Ctrl-C 这一路，也正是
  本自测盯住的那条。

