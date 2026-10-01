# 测试规范（入口）

> 本目录是**测试这件事的权威位置**：分几层、每层管什么、什么时候必须补、
> 怎么算通过。改测试相关的规则只改这里，别在别处再写一份。

---

## 三层，各有各的职责

三层不是「越多越好」的堆叠，而是**各自覆盖对方的盲区**。选错层会写出
跑得很欢却抓不到问题的测试。

| 层 | 工具 | 跑在哪 | 覆盖什么 | 抓不到什么 |
| --- | --- | --- | --- | --- |
| **单元 / 组件** | Vitest + Testing Library | jsdom | 纯逻辑：解析、时长、筛选、报告、状态机；组件的交互与无障碍标注 | 真实浏览器的排版、CSS 层叠、整体流程 |
| **端到端** | Playwright | 真实 Chromium，跑 `vite build` 的**产物** | 用户流程：发现会话 → 选中 → 切视图 → 筛选 → 出报告；CSS 层叠引发的真实缺陷 | Tauri 外壳是否承载得起来；真实文件系统与进程 |
| **真机 GUI** | `scripts/gui-test.sh` | 打包后的 `.app` | 应用真的能启动、webview 真的加载、**整条 IPC + 文件系统链路真的走通** | 界面细节（截图受系统权限限制） |

**为什么三层都要**：v0.2.1 发布连挂两次，两次都是「本地全绿、发布才炸」——
单元测试不可能发现 Windows runner 的 shell 是 PowerShell；
反过来，GUI 冒烟测试也不会告诉你某个筛选函数的边界条件写错了。
分层的意义是让每类缺陷都有地方被抓住。

## 改了什么 → 必须补哪层

| 你改了什么 | 必须补 | 建议补 |
| --- | --- | --- |
| 解析 / 时长 / 筛选 / 报告 / 虚拟化等纯逻辑 | 单元（**带夹具用例**） | —— |
| 组件的行为、无障碍标注、交互 | 单元 | 端到端 |
| 布局、CSS、主题 | 端到端 | 真机截图 |
| 用户流程的增删改 | 端到端 | —— |
| Tauri 命令、capabilities、权限 | —— | 真机 GUI（IPC 链路） |
| 打包脚本、`tauri.conf.json` | —— | **发预发布 tag 真跑一次**（见 `AGENTS.md`） |
| `scripts/` 下的纯逻辑脚本（如发布说明转换） | 脚本自测：夹具 + 断言，`scripts/<名字>-test.sh`，夹具在 `scripts/tests/fixtures/` | 接进 `.github/workflows/ci.yml` 的一个 job，否则它只在有人记得跑时才有意义 |

**凡是新增功能，都要带测试。** 这不是「有时间再说」的项——
维护者的原话是「确保后面加的每一个功能都不会影响到老功能」，
而这句话只有测试网能兑现。

---

## 动手前检查（Pre-Development Checklist）

- [ ] 确认要改的东西落在上面哪一行，知道该补哪一层
- [ ] 夹具够不够用？`web/tests/fixtures/` 里有没有能复现的场景
- [ ] 这个改动会不会让既有的断言**变成恒真**（见 `pitfalls.md` 的「夹具健全性」）
- [ ] 如果改的是 CSS，先想清楚这个选择器的**特异性**会不会波及无关元素
      （真实案例见 `pitfalls.md` 第一条）

## 完成标准（Quality Check）

- [ ] `npm --prefix web test` 全绿
- [ ] `npm --prefix web run test:e2e` 全绿
- [ ] `./scripts/gui-test.sh` 通过（改了打包或 IPC 时必须跑）
- [ ] `./scripts/lint.sh` 全绿
- [ ] 新增的夹具放在 `web/tests/fixtures/`，端到端与单测**共用同一批数据**
- [ ] 没有为了凑覆盖率而写的断言——**能发现真实回归**的才算数

---

## 命令速查

| 目的 | 命令 |
| --- | --- |
| 单元 / 组件测试 | `npm --prefix web test`（或根目录 `npm test`） |
| 端到端测试 | `npm --prefix web run test:e2e` |
| 看端到端报告 | `npm --prefix web run test:e2e:report` |
| 真机 GUI 冒烟 | `./scripts/gui-test.sh`（加 `--build` 先构建） |
| 只跑某条端到端用例 | `npm --prefix web run test:e2e -- --grep "关键词"` |

## 本目录文件

| 文件 | 内容 |
| --- | --- |
| [unit-tests.md](./unit-tests.md) | Vitest 约定、夹具用法、断言写法 |
| [e2e-tests.md](./e2e-tests.md) | Playwright 结构、桥接打桩原理、选择器与调试 |
| [gui-tests.md](./gui-tests.md) | 真机测试原理、隔离、截图权限约束 |
| [pitfalls.md](./pitfalls.md) | **踩过的坑**——每条都附现象、根因与防复发手段 |
