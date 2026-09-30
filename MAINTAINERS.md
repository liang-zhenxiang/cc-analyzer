# 维护者

CC Analyzer 的**版权归 CC Analyzer 项目所有**，见 [`LICENSE`](LICENSE) 与
[`NOTICE`](NOTICE)——署名是项目名而不是个人，这样维护者更替时版权归属保持稳定。

本文件记录**实际负责维护的人**，即提交、评审、发布这些事由谁来做。

| 维护者 | 邮箱 | 主要职责 |
| --- | --- | --- |
| [@liang-zhenxiang](https://github.com/liang-zhenxiang) | 116311683@qq.com | 项目发起人、仓库管理员（Admin） |
| [@nicholyx](https://github.com/nicholyx) | nicholyx@163.com | 维护者（Write + Triage） |

## 联系方式

- **Bug 与功能建议**：走 [Issue](https://github.com/liang-zhenxiang/cc-analyzer/issues/new/choose)。
  不要直接私信——公开讨论能让遇到同样问题的人受益，也能留下可检索的记录。
- **安全漏洞**：按 [`SECURITY.md`](SECURITY.md) 的私有渠道报告，不要在公开 Issue 里贴。
- **合作、授权等事务**：通过上表邮箱联系。

## 维护者名单的同步位置

增删维护者时，以下几处需要一起改（缺一处就会出现「名单不一致」）：

- 本文件
- [`.github/CODEOWNERS`](.github/CODEOWNERS) —— GitHub 据此把评审请求路由到对应维护者
- [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) 的 `authors`
- [`web/package.json`](web/package.json) 的 `author` 与 `contributors`