# 真实 JSONL 中的压缩记录——已验证事实（2026-10-09）

> 验证人：主会话（维护者）。方法：`python3 -I` 扫描本机 `~/.claude/projects/**/*.jsonl`
> 共 371 个文件、约 25 万条记录。所有字段名直接来自真实数据，非转述。

## 1. 压缩边界记录（锚点一）

`type: "system"` 且 `subtype: "compact_boundary"` 的记录，字段：

```jsonc
{
  "parentUuid": null,              // 注意：为 null，真正的挂靠点是 logicalParentUuid
  "logicalParentUuid": "…",        // 压缩前最后一条消息的 uuid
  "isSidechain": false,
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
  "compactMetadata": {
    "trigger": "manual" | "auto",            // 本机实测 10 次：auto 8 次、manual 2 次
    "preTokens": 422858,                     // 压缩前上下文规模
    "postTokens": 11359,                     // 压缩后上下文规模
    "cumulativeDroppedTokens": 411499,       // 累计丢弃（= pre − post 与前次累计一致）
    "durationMs": 37455,                     // 压缩耗时
    "preservedSegment": {                    // 幸存段的头/锚/尾
      "headUuid": "…", "anchorUuid": "…", "tailUuid": "…"
    },
    "preservedMessages": {
      "anchorUuid": "…",
      "uuids": ["…6 个…"],                  // 实际幸存的消息 uuid
      "allUuids": ["…同上…"]                 // 同一批（本机样本两字段一致）
    }
  },
  "uuid": "…", "timestamp": "2026-09-30T16:53:12.596Z"
}
```

## 2. 压缩摘要消息（锚点二）

紧随边界记录之后有一条 `type: "user"`、`isCompactSummary: true` 的消息：

- `parentUuid` 指向 compact_boundary 的 uuid（时间戳早边界约 1 秒，边界先写、摘要后写）
- `isVisibleInTranscriptOnly: true`
- 正文以 `This session is being continued from a previous conversation that ran out of context.` 开头，
  后跟结构化 Summary（Primary Request and Intent / …，中英文都可能）
- `message.usage` 为 null——摘要消息本身不带用量

## 3. 逐消息上下文规模（锚点三，画压力曲线的数据源）

每条 `type: "assistant"` 的 `message.usage`（73054 条全有）：

| 字段 | 出现次数 |
| --- | --- |
| `input_tokens` | 73054 / 73054 |
| `output_tokens` | 73054 / 73054 |
| `cache_read_input_tokens` | 66259 |
| `cache_creation_input_tokens` | 62848 |

**上下文规模（该次调用喂给模型的总量）= input_tokens + cache_read_input_tokens + cache_creation_input_tokens。**
压缩后该值应从 preTokens 量级掉到 postTokens 量级——曲线上的断崖即压缩事件。

## 4. 记录类型分布（解析覆盖率的分母）

`attachment` 106219、`assistant` 73014、`user` 36079、`last-prompt` 8523、`atis-latch` 8508、
`mode` 8248、`permission-mode` 8236、`ai-title` 5576、`pr-link` 5265、`system` 1384、
`agent-name` 1274、`agent-setting` 1225。

## 5. 对实现的硬约束

1. compact_boundary 的 `parentUuid` 是 null，**挂时间线要用 `logicalParentUuid`**。
2. `preTokens/postTokens` 的语义是「上下文 token」，与 usage 的 token 同量纲，可直接同图。
3. 摘要消息 `isCompactSummary: true` 不能算作用户发言（现有解析若把它当 user 行，要甄别）。
4. `cumulativeDroppedTokens` 已是累计值，**不要自己再累加**。
5. `preservedMessages.uuids` 给出精确幸存清单 → 「被丢出上下文的消息」 = 压缩点之前全部消息 − 幸存清单，
   每条消息我们已有 uuid、时间戳与摘要，可直接点名。
