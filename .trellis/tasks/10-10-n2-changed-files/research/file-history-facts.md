# Research: 会话改动文件视图的数据地基（Issue #148）

- **Query**: file-history-snapshot/delta 实测结构、现有文件痕迹盘点、CCHV Recent Edits 参考
- **Scope**: mixed（本机 ~/.claude/projects 全量扫描 + 仓库代码 + 竞品源码）
- **Date**: 2026-10-10
- **数据面**: 381 个会话 JSONL（967MB），时间跨度至 2026-10-09

---

## 1. file-history-snapshot / delta 实测

### 1.1 频率

| 指标 | file-history-snapshot | file-history-delta |
|---|---|---|
| 含该记录的会话文件 | 67 / 381（17%） | 37 / 381（10%） |
| 行总数 | 303 | 1234 |
| 每会话条数 | 1~24（中位 3，均值 4.5，p90 9） | —（逐文件事件流） |
| 单行字节 | 235B ~ 24KB（中位 1.25KB，p90 14KB） | 326 ~ 559B |
| 全量合计 | **1.2MB** | ~0.5MB |
| timestamp 范围 | 2026-09-07 → 2026-10-09 | 同期 |

- **更早的会话完全没有这两种记录**——约一个月前的新版本 Claude Code 才开始写。
- 快照行中 138 条 `trackedFileBackups` 为空 dict、165 条非空（会话启动时先写一条空表快照）。

### 1.2 结构（脱敏样本）

快照（一条 = 当时整个追踪表的全量序列化）：

```jsonc
{
  "type": "file-history-snapshot",
  "messageId": "<uuid>",
  "snapshot": {
    "messageId": "<uuid>",
    "trackedFileBackups": {
      "⟨相对路径，如 .trellis/spec/…/index.md⟩": {
        "backupFileName": "⟨16位hex⟩@v2",   // 或 null（实测 1355 null / 4414 有值）
        "version": 2,
        "backupTime": "2026-09-15T13:54:36.717Z",
        "realParentDir": "⟨目录⟩/spec"      // 该文件真实父目录（绝对路径）
      },
      "⟨绝对路径，如 /tmp/xxx.md⟩": { …同结构… }
    },
    "timestamp": "2026-09-15T13:54:36.717Z"
  },
  "isSnapshotUpdate": false                  // 303 条实测全为 false
}
```

delta（一条 = 单个文件开始被追踪的事件）：

```jsonc
{
  "type": "file-history-delta",
  "messageId": "<uuid>",
  "snapshotMessageId": "<uuid>",             // 回指所属快照
  "trackingPath": "⟨相对或绝对路径，单文件⟩",
  "backup": { "backupFileName": "…@vN|null", "version": N, "backupTime": "ISO", "realParentDir": "⟨目录⟩" },
  "timestamp": "ISO"
}
```

要点：
- **不含文件内容**。`backupFileName` 指向 `~/.claude/file-history/<sessionId>/<hash>@vN` 的**明文全文备份**（编辑前内容；实测含 `---\n` 开头的 markdown、`const ` 开头的 JS、`{\n  "id"` 开头的 JSON，最大单备份 2.8MB；34 个 sessionId 目录共 49MB）。
- 路径形态：相对 77% / 绝对 23%；相对路径可靠 `realParentDir` 恢复绝对位置。
- 有时机标记：每文件 `backupTime`（首次备份时间）+ `version`（备份版本数）。
- 快照行写入时机（时间线实测，637ceb0d 会话）：**编辑发生时不写**；在会话启动、resume、下一个 user turn 开始时写入累积表。

### 1.3 与 Edit/Write/NotebookEdit 的重合度（67 会话全量实测）

| 集合 | 文件数 |
|---|---|
| 快照并集（A'） | 1038 |
| tool_use 编辑集（Edit/Write/NotebookEdit 去重） | 1382 |
| 交集 | 1024 |
| 仅快照 | 14（1.3%） |
| 仅编辑 | 358（26%） |

- **快照 ⊆ 编辑（98.7%）**：快照几乎不多算。仅快照的 14 个 = 一部分 `backupFileName=null` 空条目 + 一部分其他并行会话改的文件混入快照表（如某会话快照里出现当天其他 Trellis 任务的 prd.md / implement.jsonl，backupTime 相同）。
- **编辑 ⊆ 快照仅 74%**：快照会系统性漏——会话最后一个 turn 的编辑（没有后续快照行）以及部分未建立备份的编辑。仅编辑的 358 个中 Write-only 238、Edit-only 84、混合 39。
- **delta 的 1221 个 trackingPath 100% 落在编辑集内**——delta 是编辑事件的精确子流，零噪音，但只在 10% 会话文件中出现。

### 1.4 内存量级

快照+delta 全部记录共 ~1.7MB（381 会话）。即便连同 `~/.claude/file-history` 索引一起进内存也是小量级；但**备份文件本体**（49MB，单文件最大 2.8MB）只应按需读取单个。

---

## 2. 现有「文件痕迹」盘点（仓库内）

| 位置 | 现状 |
|---|---|
| `web/src/features/sessions/parseJsonl.ts:41-42` | `file-history-snapshot`、`file-history-delta` 在 `SKIPPED_EVENT_TYPES` 中被显式跳过（开发者已知其存在） |
| `web/src/features/sessions/parseJsonl.ts:559-583` | tool_use 块 → `SessionRecord.toolName` + `toolInput`（Edit/Write/NotebookEdit 的 `file_path`/`notebook_path` 都在其中）；sidechain（子 agent）的 tool 记录单独收集进 `sidechainMessages`，同样带 `toolInput` |
| `web/src/features/sessions/structuredToolResult.ts:33-47` | 已提取 Edit/Write 的 `filePath`；**Write 的 `created`（`result.type === "create"`，新建 vs 覆盖）**；Edit 的 `oldString`/`newString`/`structuredPatch` |
| `web/src/features/sessions/reportPrompt.ts:243-285` | `fileMapSection()` 已有 per-session 文件聚合：次数、累计耗时、工具集合，取 `structuredResult.filePath` ?? `toolInput.file_path/path/notebook_path`。但**语义是「接触过」**（含 Read/Grep/Glob 的 path），只服务于报告 prompt，非 UI 视图 |
| 全局搜索 | 无 changedFiles / per-session 改动文件 UI 聚合 |

结论：A 方案所需的原料（工具名、输入路径、结果路径、create 标记、isError、时间戳）**全部已在 `SessionRecord` 里**，缺的只是一个限定工具集的新聚合函数 + 视图。

---

## 3. 竞品 CCHV（claude-code-history-viewer）参考

读了 README 与 `src-tauri/src/commands/session/edits.rs`（2277 行）：

1. **数据源与我们的 A 方案相同**：Recent Edits 从 tool_use / toolUseResult 提取（Write `type:"create"`、Edit `old_string`/`new_string`/structuredPatch），**不读 file-history 快照**；快照记录在它那里只是消息流里一个可渲染块。编辑内容视图（content/added/removed/diff）靠 `apply_edit()` 重放编辑步骤生成。
2. **视图形态**：会话内与 Messages/Analytics 并列的 Tab；按文件分组或按编辑时间线分组，行级信息 = 文件路径（剥项目前缀）+ 相对时间 + `exists_on_disk` 探测 + Missing Only 过滤 + 分页。
3. **restore 安全模型**（#525）：前端传内容、后端校验（绝对路径、无 null 字节、无 `..` 穿越、会话归属 scope），**不读备份目录**。

---

## 4. 两个候选数据源对比

| 维度 | A：tool_use 聚合 | B：快照/delta 新解析 |
|---|---|---|
| 语义 | 「实际动过哪些文件」——正是 Issue #148 的问题 | 「建立了编辑前备份的文件」 |
| 覆盖面 | 100% 的 Edit/Write/NotebookEdit（含次数、首末时间、old/new 串、新建/覆盖、isError） | 快照只覆盖 74% 编辑；delta 精确（100% ⊆ 编辑）但仅 10% 会话有 |
| 会话适用率 | 全部会话（含历史） | 约 17% / 10%（一个月内新版本起的会话） |
| 独有能力 | 每次编辑的 old/new 内容（可重放 diff）、次数统计 | `backupTime`/`version`；`~/.claude/file-history` **全文备份指针**（改动前内容，可做精确前后对比/回放） |
| 工作量 | 低：聚合函数（参考 fileMapSection 限工具集）+ UI | 中：解析两种新记录类型；读备份目录需 Tauri 侧新 fs 权限/命令 |
| 风险 | 「动了」≠「改成功」：失败编辑也在（可用 isError / 是否有 structuredResult 过滤）；Bash 间接写文件不可见 | 非官方稳定契约（isSnapshotUpdate 恒 false 提示格式仍在演化）；老会话无；偶混入并行会话条目（1.3%） |

## 5. 建议

**视图主体基于 A（tool_use 聚合）**：语义正确、覆盖全、历史会话可用、解析地基已全部就位。具体可聚合出：文件、编辑次数（Edit+Write+NotebookEdit 分列）、首/末编辑时间、新建 or 修改（Write created）、是否仍在错误态。`fileMapSection` 的提取逻辑可直接复用，但必须限定工具集（它现在把 Read/Grep 也算进去）。

**B 作为后续增强，不进第一期**：等需要「改动前内容预览 / 精确回放」时再读 `file-history-delta`（优先，逐文件、零噪音、带 backupTime）与备份文件本体；快照行价值最低（既是全量冗余又覆盖不全）。

## 6. 结论：可行性与最大风险

**可行**——A 方案零新增解析、零新增权限，纯前端聚合 + UI；数据实测 67 会话 1382 个编辑文件聚合毫无压力。

**最大风险**：语义边界要在设计时说清——① tool_use 记录的是「尝试改动」，失败的编辑需按 `isError`/有无 `structuredResult` 决定计入与否；② Bash（sed/heredoc/git checkout 等间接写文件）在两个数据源里都不可见，视图口径应表述为「通过文件工具改动」，不要宣称「工作区全部变更」（后者只有 git 知道）。

---

## Caveats / Not Found

- `isSnapshotUpdate` 恒为 false，含义未知（推测为预留字段）；快照行 timestamp 与行序偶有乱序（resume 补写）。
- 仅快照 14 个文件中「并行会话混入」的机制未深究（疑似共享追踪表），占比 1.3%，不影响结论。
- 未实测 NotebookEdit 样本（本机会话中未发现该工具调用）；路径归一化用 `realParentDir` + basename 重建，多级相对路径的中间目录在重合度比对中可能有个别误差，方向上不影响结论。
