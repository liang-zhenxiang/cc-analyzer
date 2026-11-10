import { useId, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { TextInput } from "../../components/TextInput";
import { formatDateTime, formatRelativeTime, formatTokenCount } from "../../lib/format";
import type { ProjectMemory } from "./projectMemory";
import styles from "./ProjectMemoryPanel.module.css";

/**
 * 项目记忆：把「这个项目里反复发生的动作」摊开成一页常读的笔记。
 *
 * 视觉上有四条约束：
 *
 * 1. **不画卡片**：左栏是项目 chip，右栏是同一个版心里的三个区块；区块之间
 *    只用 32px 留白与发丝线分层，不套第二层有底色的容器。
 * 2. **颜色只标记状态**：命令失败只给一个小三角，未恢复的坑只给一个
 *    `--warning` 圆点——整行染红会让「哪一行更重要」失去信息量。
 * 3. **数字等宽**：次数、token、读写次数全部 `tabular-nums`，纵向扫读时
 *    数位对齐，不需要逐行辨认。
 * 4. **图只画形**：热度条 `aria-hidden`，读数是旁边的「N 触碰 · M 改」（touches 含读与写）。
 *
 * 搜索只过滤命令与文件名（坑的签名不参与），因为用户找的是「那个命令
 * 跑哪去了」，而不是在一堆报错里做全文检索。
 */
export function ProjectMemoryPanel({ memories }: { memories: readonly ProjectMemory[] }) {
  // useId 而不是写死 id：同一页渲染两份面板时 label 也不会串。
  const searchId = useId();
  const [query, setQuery] = useState("");
  // null = 还没有手动选过：默认总是跟随列表第一个项目。这样数据异步到达、
  // 或项目列表被时间窗口裁掉时，选中项不会停留在一个已经不存在的名字上。
  const [activeProject, setActiveProject] = useState<string | null>(null);

  // 所有 hooks 必须在 early return 之前调用（Rules of Hooks）。
  if (memories.length === 0) {
    return (
      <section className={styles.empty} aria-label="项目记忆" data-probe="project-memory">
        <EmptyState
          size="page"
          title="这个窗口还没有项目记忆"
          description="先扫描一次日志目录，再用上一段时间，这里会自动长出项目笔记。"
        />
      </section>
    );
  }

  const active = memories.find((memory) => memory.project === activeProject) ?? memories[0];
  const needle = query.trim().toLowerCase();
  const commands = needle
    ? active.commands.filter((entry) => entry.command.toLowerCase().includes(needle))
    : active.commands;
  const files = needle
    ? active.files.filter((entry) => entry.name.toLowerCase().includes(needle))
    : active.files;
  // 热度按**整个项目**的最大 touches 归一，而不是按过滤后的结果：
  // 搜索把范围收窄时，条长仍代表同一个量级，不会把 3 次看成的 30 次。
  const maxTouches = active.files.reduce((max, entry) => Math.max(max, entry.touches), 0);
  const noMatches = needle.length > 0 && commands.length === 0 && files.length === 0;
  const hasAnyData =
    active.commands.length > 0 || active.files.length > 0 || active.pitfalls.length > 0;

  return (
    <section className={styles.panel} aria-label="项目记忆" data-probe="project-memory">
      <aside className={styles.rail}>
        <ul className={styles.projectList} aria-label="项目">
          {memories.map((memory) => {
            const selected = memory.project === active.project;
            return (
              <li key={memory.project} className={styles.projectItem}>
                <button
                  type="button"
                  className={styles.projectButton}
                  aria-pressed={selected}
                  title={memory.project}
                  data-probe="memory-project"
                  onClick={() => {
                    setActiveProject(memory.project);
                    // 切换项目时清空搜索：否则新项目一进来就是「没有匹配」，
                    // 用户会误以为这个项目没有记忆。
                    setQuery("");
                  }}
                >
                  <span className={styles.chipName}>{memory.project}</span>
                  <span className={styles.chipSessions}>{memory.sessions}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className={styles.content}>
        <header className={styles.header}>
          <h2 className={styles.projectTitle} title={active.project}>
            {active.project}
          </h2>
          <dl className={styles.readouts}>
            <div className={styles.readout}>
              <dt className={styles.readoutLabel}>会话</dt>
              <dd className={styles.readoutValue}>{active.sessions.toLocaleString("en-US")}</dd>
            </div>
            <div className={styles.readout}>
              <dt className={styles.readoutLabel}>token</dt>
              <dd
                className={styles.readoutValue}
                title={`${active.tokens.toLocaleString("en-US")} token`}
              >
                {formatTokenCount(active.tokens)}
              </dd>
            </div>
            <div className={styles.readout}>
              <dt className={styles.readoutLabel}>最近活跃</dt>
              <dd
                className={styles.readoutValue}
                title={active.lastActive > 0 ? formatDateTime(active.lastActive) : undefined}
              >
                {formatRelativeTime(active.lastActive)}
              </dd>
            </div>
          </dl>
        </header>

        <div className={styles.searchRow}>
          <label className={styles.srOnly} htmlFor={searchId}>
            搜索命令或文件
          </label>
          <TextInput
            id={searchId}
            type="search"
            className={styles.searchInput}
            placeholder="筛选命令或文件…"
            value={query}
            autoComplete="off"
            data-probe="memory-search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {noMatches ? (
          <p className={styles.noMatch} role="status" data-probe="memory-no-match">
            没有匹配的命令或文件
          </p>
        ) : null}

        <div className={styles.sections}>
          {commands.length > 0 ? (
            <section className={styles.section} aria-labelledby={`${searchId}-commands`}>
              <h3 id={`${searchId}-commands`} className={styles.sectionTitle}>
                常用命令
              </h3>
              <ul className={styles.rows}>
                {commands.map((entry) => (
                  <li
                    key={entry.command}
                    className={styles.commandRow}
                    data-probe="memory-command"
                  >
                    <span className={styles.command} title={entry.command}>
                      {entry.command}
                    </span>
                    <span className={styles.commandMeta}>
                      {entry.failures > 0 ? (
                        <span
                          className={styles.failureMark}
                          role="img"
                          aria-label={`${entry.failures} 次失败`}
                          title={`${entry.failures} 次失败`}
                        >
                          △
                        </span>
                      ) : null}
                      <span
                        className={styles.countBadge}
                        title={`${entry.count.toLocaleString("en-US")} 次`}
                      >
                        {entry.count.toLocaleString("en-US")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {files.length > 0 ? (
            <section className={styles.section} aria-labelledby={`${searchId}-files`}>
              <h3 id={`${searchId}-files`} className={styles.sectionTitle}>
                热文件
              </h3>
              <ul className={styles.rows}>
                {files.map((entry) => (
                  <li key={entry.name} className={styles.fileRow} data-probe="memory-file">
                    <span className={styles.fileName} title={entry.name}>
                      {entry.name}
                    </span>
                    <span className={styles.heatTrack} aria-hidden="true">
                      {entry.touches > 0 ? (
                        <span
                          className={styles.heatFill}
                          style={{
                            width: `${maxTouches > 0 ? (entry.touches / maxTouches) * 100 : 0}%`
                          }}
                          data-probe="memory-heat"
                        />
                      ) : null}
                    </span>
                    <span className={styles.fileMeta}>
                      {`${entry.touches.toLocaleString("en-US")} 触碰 · ${entry.edits.toLocaleString(
                        "en-US"
                      )} 改`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {active.pitfalls.length > 0 ? (
            <section className={styles.section} aria-labelledby={`${searchId}-pitfalls`}>
              <h3 id={`${searchId}-pitfalls`} className={styles.sectionTitle}>
                坑与恢复
              </h3>
              <ul className={styles.rows}>
                {active.pitfalls.map((entry) => (
                  <li
                    key={`${entry.tool}:${entry.signature}:${entry.firstSeen}`}
                    className={styles.pitfallRow}
                    data-probe="memory-pitfall"
                  >
                    <span className={styles.signature} title={entry.signature}>
                      {entry.signature}
                    </span>
                    <span className={styles.pitfallMeta}>
                      <span className={styles.pitfallTool}>{entry.tool}</span>
                      <span className={styles.pitfallCount}>
                        {`${entry.failures.toLocaleString("en-US")} 次`}
                      </span>
                    </span>
                    <span className={entry.recovered ? styles.recovered : styles.unrecovered}>
                      {entry.recovered ? (
                        <>
                          <span aria-hidden="true">✓</span> 已恢复
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">●</span> 未恢复
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {!hasAnyData && needle.length === 0 ? (
          <p className={styles.emptyNote}>这个项目还没有留下可归纳的记忆。</p>
        ) : null}
      </div>
    </section>
  );
}
