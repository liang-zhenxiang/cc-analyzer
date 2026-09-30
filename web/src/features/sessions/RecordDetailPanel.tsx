import { useState } from "react";
import type { ClipboardService, SystemService } from "../../api/types";
import { isPathInsideAny, parentDirectory, sessionDirectory } from "../../lib/path";
import type { SessionRecord } from "./types";
import { RecordTable } from "./RecordTable";
import { Button } from "../../components/Button";
import { formatDateTime, formatDuration } from "../../lib/format";
import { tokensOf } from "./logRows";
import { formatInputValue, structuredResultLines } from "./structuredResultLines";
import { safeStringify } from "../../lib/json";
import styles from "./RecordDetailPanel.module.css";

export function RecordDetailPanel({
  record,
  graphWarnings,
  clipboard,
  system,
  onLocate,
  onSelectChild,
  sessionId,
  sessionPath
}: {
  record: SessionRecord;
  graphWarnings?: string[];
  clipboard: ClipboardService;
  system: SystemService;
  onLocate: (recordId: string) => void;
  onSelectChild?: (record: SessionRecord) => void;
  sessionId?: string;
  sessionPath?: string;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const childSessions = record.childSessions ?? [];
  const tokens = tokensOf(record);
  const structuredLines = structuredResultLines(record);
  const sessionFolder = sessionPath ? parentDirectory(sessionPath) : undefined;
  const childDirectory = record.childSessionPath
    ? parentDirectory(record.childSessionPath)
    : undefined;
  // A crafted session file can point `childSessionPath` anywhere; only offer to
  // open it when the resolver would also have been allowed to read it.
  const childPathInScope =
    !record.childSessionPath ||
    !sessionPath ||
    isPathInsideAny(record.childSessionPath, [
      sessionDirectory(sessionPath),
      parentDirectory(sessionPath)
    ].filter((root): root is string => Boolean(root)));

  async function runAction(label: string, action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(`${label} 失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return (
    <aside className={styles.panel} aria-label="记录详情">
      <header>
        <h3>记录详情</h3>
        <code>{record.fullId}</code>
      </header>
      <dl>
        <dt>类型</dt><dd>{record.kind}</dd>
        <dt>时间</dt><dd>{formatDateTime(record.timestamp)}</dd>
        <dt>耗时</dt><dd>{formatDuration(record.durationMs)}</dd>
        <dt>状态</dt><dd className={record.isError ? styles.error : undefined}>{record.isError ? "失败" : "正常"}</dd>
        {record.toolName ? <><dt>工具</dt><dd>{record.toolName}</dd></> : null}
        {record.model ? <><dt>模型</dt><dd>{record.model}</dd></> : null}
        {tokens ? (
          <>
            <dt>Token</dt>
            {/* 与日志表同一口径，标签也必须同口径：这里是提示词总量，不是 input_tokens。
                四个计数在 Token 面板里分开列。 */}
            <dd>提示词(含缓存) {tokens.prompt} / 输出 {tokens.output}</dd>
          </>
        ) : null}
        {record.resultTruncated ? <><dt>输出</dt><dd>已截断</dd></> : null}
      </dl>
      {record.apiError ? (
        <section aria-label="API 错误">
          <h4>API 错误</h4>
          <p>
            {record.apiError.kind ?? "未知"}
            {record.apiError.status == null ? "" : ` (${record.apiError.status})`}
          </p>
        </section>
      ) : null}
      {record.toolInput != null ? (
        <section aria-label="工具输入">
          <h4>工具输入</h4>
          <pre>{formatInputValue(record.toolInput)}</pre>
        </section>
      ) : null}
      {record.toolResult != null ? (
        <section aria-label="工具输出">
          <h4>工具输出</h4>
          <pre>{record.toolResult || "（无输出）"}</pre>
        </section>
      ) : null}
      {structuredLines.length > 0 ? (
        <section aria-label="结构化结果">
          <h4>{record.structuredResult?.toolName ?? "结构化结果"}</h4>
          <pre>{structuredLines.join("\n")}</pre>
        </section>
      ) : null}
      <section aria-label="记录原文">
        <pre>{safeStringify(record.raw, 2)}</pre>
      </section>
      {record.childSession ? (
        <section aria-label="子 agent 记录">
          <h4>子 agent 记录</h4>
          <RecordTable
            records={record.childSession.records}
            selectedId={null}
            onSelect={(child) => onSelectChild?.(child)}
          />
        </section>
      ) : null}

      {record.workflowRun ? (
        <section aria-label="Workflow 摘要">
          <h4>{record.workflowRun.workflowName || "Workflow"}</h4>
          <dl>
            <dt>状态</dt><dd>{record.workflowRun.status || "未知"}</dd>
            <dt>子 agent</dt><dd>{record.workflowRun.agentCount}</dd>
            <dt>运行时长</dt><dd>{formatDuration(record.workflowRun.durationMs)}</dd>
            <dt>开始时间</dt><dd>{record.workflowRun.startTs === null ? "—" : formatDateTime(record.workflowRun.startTs)}</dd>
            <dt>Token</dt><dd>{record.workflowRun.totalTokens ?? "—"}</dd>
            <dt>工具调用</dt><dd>{record.workflowRun.totalToolCalls ?? "—"}</dd>
            <dt>阶段</dt><dd>{record.workflowRun.phases.join(" → ") || "—"}</dd>
          </dl>
          {record.workflowRun.summary ? <p>{record.workflowRun.summary}</p> : null}
          {record.workflowRun.logs.length ? (
            <pre aria-label="Workflow 日志">{record.workflowRun.logs.join("\n")}</pre>
          ) : null}
          {record.workflowRun.resultText ? (
            <>
              {record.workflowRun.resultTruncated ? (
                <p role="note">结果已截断，只保留前 4000 字符。</p>
              ) : null}
              <pre aria-label="Workflow 结果">{record.workflowRun.resultText}</pre>
            </>
          ) : null}
        </section>
      ) : null}

      {childSessions.map((child, index) => (
        <section key={child.path} aria-label={`Workflow 子 agent ${index + 1}`}>
          <h4>Workflow 子 agent {index + 1}</h4>
          <RecordTable
            records={child.records}
            selectedId={null}
            onSelect={(childRecord) => onSelectChild?.(childRecord)}
          />
        </section>
      ))}

      {graphWarnings?.length ? (
        <section aria-label="会话图警告">
          <h4>会话图警告</h4>
          <ul>
            {graphWarnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.actions}>
        <Button type="button" onClick={() => void runAction("复制 ID", () => clipboard.writeText(record.fullId))}>复制 ID</Button>
        <Button type="button" onClick={() => void runAction("复制摘要", () => clipboard.writeText(record.text))}>复制摘要</Button>
        <Button type="button" onClick={() => onLocate(record.fullId)}>在树视图定位</Button>
        {record.childSessionPath && childPathInScope ? (
          <Button type="button" onClick={() => {
            if (childDirectory) void runAction("打开位置", () => system.openFolder(childDirectory));
          }}>
            打开位置
          </Button>
        ) : null}
        {sessionId ? (
          <Button type="button" onClick={() => void runAction("打开 Claude 终端", () => system.openClaudeTerminal(sessionId))}>
            打开 Claude 终端
          </Button>
        ) : null}
        {sessionId ? (
          <Button type="button" onClick={() => void runAction("复制会话 ID", () => clipboard.writeText(sessionId))}>
            复制会话 ID
          </Button>
        ) : null}
        {sessionPath ? (
          <Button type="button" onClick={() => void runAction("复制路径", () => clipboard.writeText(sessionPath))}>
            复制路径
          </Button>
        ) : null}
        {sessionFolder ? (
          <Button type="button" onClick={() => void runAction("打开会话文件夹", () => system.openFolder(sessionFolder))}>
            打开会话文件夹
          </Button>
        ) : null}
      </div>
      {actionError ? <div role="alert">{actionError}</div> : null}
    </aside>
  );
}
