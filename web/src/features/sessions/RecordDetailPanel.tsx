import { useState } from "react";
import { useNotifications } from "../../app/NotificationProvider";
import type { ClipboardService, SystemService } from "../../api/types";
import { isPathInsideAny, parentDirectory, sessionDirectory } from "../../lib/path";
import type { SessionRecord } from "./types";
import { RecordTable } from "./RecordTable";
import { Button, IconButton } from "../../components/Button";
import { AnsiText } from "../../components/AnsiText";
import { Icon } from "../../components/Icon";
import { formatDateTime, formatDuration } from "../../lib/format";
import { tokensOf } from "./logRows";
import { formatInputValue, structuredResultLines } from "./structuredResultLines";
import { recordSummary } from "./recordSummary";
import { safeStringify } from "../../lib/json";
import styles from "./RecordDetailPanel.module.css";

export function RecordDetailPanel({
  record,
  graphWarnings,
  clipboard,
  system,
  onLocate,
  onClose,
  onSelectChild,
  sessionId,
  sessionPath
}: {
  record: SessionRecord;
  graphWarnings?: string[];
  clipboard: ClipboardService;
  system: SystemService;
  onLocate: (recordId: string) => void;
  /** 收起面板——选中状态归页面所有，所以由页面传进来。 */
  onClose?: () => void;
  onSelectChild?: (record: SessionRecord) => void;
  sessionId?: string;
  sessionPath?: string;
}) {
  const { notify } = useNotifications();
  const [actionError, setActionError] = useState<string | null>(null);
  const summary = recordSummary(record);
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

  /**
   * 失败时既写就地可见的 `actionError`（不会被 3.2 秒后消失的 toast 带走），
   * 也弹一条 error toast；成功时只弹 toast。
   *
   * `successMessage` 只给「复制」这类**没有别的可见结果**的动作——
   * 打开文件夹/终端本身就会把窗口弹到前台，再补一句「已打开」是噪音。
   */
  async function runAction(label: string, action: () => Promise<void>, successMessage?: string) {
    setActionError(null);
    try {
      await action();
      if (successMessage) notify(successMessage, "success");
    } catch (cause) {
      const message = `${label} 失败: ${cause instanceof Error ? cause.message : String(cause)}`;
      setActionError(message);
      notify(message, "error");
    }
  }
  return (
    <aside className={styles.panel} aria-label="记录详情">
      <header>
        <div className={styles.headerTitle}>
          <h3>记录详情</h3>
          {onClose ? (
            <IconButton label="收起详情" onClick={onClose}>
              <Icon name="close" />
            </IconButton>
          ) : null}
        </div>
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
          {/* 工具输入里也可能是终端文本（Edit 写入的片段、脚本正文），
              同样按转义语义渲染，免得整块面板里混着 `[31m` 乱码。 */}
          <pre>
            <AnsiText text={formatInputValue(record.toolInput)} />
          </pre>
        </section>
      ) : null}
      {record.toolResult != null ? (
        <section aria-label="工具输出">
          <h4>工具输出</h4>
          {/* 终端输出带色渲染：这是全应用里最像「终端」的一块面板。 */}
          <pre>{record.toolResult ? <AnsiText text={record.toolResult} /> : "（无输出）"}</pre>
        </section>
      ) : null}
      {structuredLines.length > 0 ? (
        <section aria-label="结构化结果">
          <h4>{record.structuredResult?.toolName ?? "结构化结果"}</h4>
          <pre>
            <AnsiText text={structuredLines.join("\n")} />
          </pre>
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
          {record.workflowRun.summary ? (
            <p>
              <AnsiText text={record.workflowRun.summary} />
            </p>
          ) : null}
          {record.workflowRun.logs.length ? (
            <pre aria-label="Workflow 日志">
              <AnsiText text={record.workflowRun.logs.join("\n")} />
            </pre>
          ) : null}
          {record.workflowRun.resultText ? (
            <>
              {record.workflowRun.resultTruncated ? (
                <p role="note">结果已截断，只保留前 4000 字符。</p>
              ) : null}
              <pre aria-label="Workflow 结果">
                <AnsiText text={record.workflowRun.resultText} />
              </pre>
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
        <Button type="button" onClick={() => void runAction("复制 ID", () => clipboard.writeText(record.fullId), "已复制记录 ID")}>复制 ID</Button>
        {/* 复制的是 recordSummary 而不是 record.text：后者对 tool 记录是空串，
            写进剪贴板等于什么都没复制。取不到内容时禁用，不静默复制空串。 */}
        <Button
          type="button"
          disabled={summary.length === 0}
          onClick={() => void runAction("复制摘要", () => clipboard.writeText(summary), "已复制摘要")}
        >
          复制摘要
        </Button>
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
          <Button type="button" onClick={() => void runAction("复制会话 ID", () => clipboard.writeText(sessionId), "已复制会话 ID")}>
            复制会话 ID
          </Button>
        ) : null}
        {sessionPath ? (
          <Button type="button" onClick={() => void runAction("复制路径", () => clipboard.writeText(sessionPath), "已复制会话路径")}>
            复制路径
          </Button>
        ) : null}
        {sessionFolder ? (
          <Button type="button" onClick={() => void runAction("打开会话文件夹", () => system.openFolder(sessionFolder))}>
            打开会话文件夹
          </Button>
        ) : null}
      </div>
      {summary.length === 0 ? (
        <p className={styles.hint}>无可复制内容：这条记录既没有文本，也没有工具调用或结果。</p>
      ) : null}
      {actionError ? <div role="alert">{actionError}</div> : null}
    </aside>
  );
}
