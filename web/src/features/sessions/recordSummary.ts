import type { SessionRecord } from "./types";
import { formatInputValue, structuredResultLines } from "./structuredResultLines";

/**
 * 「复制摘要」要复制的文本——**不等于** `record.text`。
 *
 * `SessionRecord.text` 的类型是 `string`，但它可以合法地是空串：
 * `parseJsonl.ts` 里只有 tool_result 没有文本的记录就是 `text: ""`。
 * 直接把 `record.text` 接到按钮上，用户会「复制成功」却什么都没拿到，
 * 而且没有任何提示。所以这里挑「最能代表这条记录的一段文本」，
 * 按下面的优先级取第一段有内容的：
 *
 * 1. `record.text`（非空白）—— 有文本就是它，**原样返回**。
 *    屏幕上「记录原文」显示的就是这段文本，改写它会让复制结果与看到的对不上。
 * 2. 工具调用（工具名 + 工具输入）—— 没有文本的记录绝大多数是 `tool_use`，
 *    「哪个工具、拿什么参数做了什么」正是这条记录的代表。
 * 3. 工具输出 —— 只有 `tool_result`、没有输入的那半边记录里，输出是唯一的内容。
 * 4. 结构化结果摘要（`structuredResultLines`）—— 输出被截断或没配对上时，
 *    这一行摘要仍能说明结果是什么。
 * 5. Workflow 摘要 / 结果 —— Workflow 记录没有 toolInput、toolResult，
 *    `summary`、`resultText` 才是它的内容。
 *
 * 都取不到时返回**空串**，调用方据此禁用按钮：绝不静默写入空串。
 */
export function recordSummary(record: SessionRecord): string {
  if (record.text.trim().length > 0) return record.text;

  const call = toolCallSummary(record);
  if (call.length > 0) return call;

  const toolResult = record.toolResult;
  if (toolResult && toolResult.trim().length > 0) return toolResult;

  const structured = structuredResultLines(record);
  if (structured.length > 0) return structured.join("\n");

  const workflow = record.workflowRun;
  if (workflow) {
    if (workflow.summary.trim().length > 0) return workflow.summary;
    if (workflow.resultText.trim().length > 0) return workflow.resultText;
  }

  return "";
}

/** `Bash: {"command":"ls -la"}`；只有一半信息时就用那一半。 */
function toolCallSummary(record: SessionRecord): string {
  const input = record.toolInput == null ? "" : formatInputValue(record.toolInput).trim();
  const name = record.toolName?.trim() ?? "";
  if (name && input) return `${name}: ${input}`;
  return name || input;
}
