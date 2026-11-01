import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { formatProjectPath, formatTokenCount } from "../../lib/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { multiCompareOf, type MultiCompareEntity } from "./multiCompare";
import styles from "./MultiComparePanel.module.css";

/**
 * I4 多选对照（实验室档，工具生态之后）。
 *
 * 模型 `multiCompareOf` 只负责「份额 / 最优 / 离散」三件几何，实体读数的
 * 归类必须由界面这一层做（与 `aggregateRange` 同一套窗口与计数规则）：
 *   - 窗口 = 本地日历「今天往前 days-1 天」，与 usageAggregations 同款；
 *   - token = 四计数器之和；
 *   - messages 只数 user / assistant（压缩摘要不是用户说的话）；
 *   - 错误 = `record.isError`；
 *   - 活跃天 = 归到自己记录所在本地日的去重数；
 *   - 会话数 = 贡献过该实体的会话去重数。
 *
 * 份额在**所选实体内部**归一（合计 100%），脚注必须写明，否则会被读成
 * 「占全站多少」。
 */

type Dimension = "project" | "model" | "tool";

const DIMENSION_ITEMS: Array<{ value: Dimension; label: string }> = [
  { value: "project", label: "项目" },
  { value: "model", label: "模型" },
  { value: "tool", label: "工具" }
];

const DIMENSION_LABEL: Record<Dimension, string> = {
  project: "项目",
  model: "模型",
  tool: "工具"
};

const MIN_PICKED = 2;
const MAX_PICKED = 4;

type Bucket = {
  id: string;
  label: string;
  sessions: Set<number>;
  tokens: number;
  messages: number;
  errors: number;
  days: Set<number>;
};

function emptyBucket(id: string, label: string): Bucket {
  return { id, label, sessions: new Set(), tokens: 0, messages: 0, errors: 0, days: new Set() };
}

function addRecord(
  bucket: Bucket,
  record: UsageSessionInput["records"][number],
  sessionIndex: number
): void {
  bucket.sessions.add(sessionIndex);
  const usage = record.usage;
  if (usage) {
    bucket.tokens +=
      (usage.inputTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      (usage.cacheReadTokens ?? 0);
  }
  if ((record.kind === "user" || record.kind === "assistant") && !record.compactSummary) {
    bucket.messages += 1;
  }
  if (record.isError) bucket.errors += 1;
  bucket.days.add(dayStartOf(record.timestamp));
}

export function MultiComparePanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
}) {
  const [dimension, setDimension] = useState<Dimension>("project");
  const [pickedByDim, setPickedByDim] = useState<Partial<Record<Dimension, string[]>>>({});

  const entities = useMemo(() => {
    const startTs = addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
    const projectPaths = new Map<string, string | undefined>();
    for (const input of inputs) {
      if (!projectPaths.has(input.projectLabel) && input.projectPath) {
        projectPaths.set(input.projectLabel, input.projectPath);
      }
    }

    const buckets = new Map<string, Bucket>();
    inputs.forEach((input, sessionIndex) => {
      for (const record of input.records) {
        if (record.timestamp < startTs) continue;

        if (dimension === "project") {
          const key = input.projectLabel;
          const bucket =
            buckets.get(key) ??
            emptyBucket(
              key,
              formatProjectPath(key, projectPaths.get(key) ?? input.session?.cwd)
            );
          addRecord(bucket, record, sessionIndex);
          buckets.set(key, bucket);
          continue;
        }

        if (dimension === "model") {
          if (!record.model) continue;
          const bucket =
            buckets.get(record.model) ?? emptyBucket(record.model, record.model);
          addRecord(bucket, record, sessionIndex);
          buckets.set(record.model, bucket);
          continue;
        }

        if (!record.toolName) continue;
        const bucket =
          buckets.get(record.toolName) ?? emptyBucket(record.toolName, record.toolName);
        addRecord(bucket, record, sessionIndex);
        buckets.set(record.toolName, bucket);
      }
    });

    return [...buckets.values()]
      .map<MultiCompareEntity>((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        metrics: {
          sessions: bucket.sessions.size,
          tokens: bucket.tokens,
          messages: bucket.messages,
          errors: bucket.errors,
          activeDays: bucket.days.size
        }
      }))
      .sort((a, b) => b.metrics.tokens - a.metrics.tokens || a.id.localeCompare(b.id))
      .slice(0, 12);
  }, [inputs, days, now, dimension]);

  const available = useMemo(() => new Set(entities.map((entity) => entity.id)), [entities]);
  const picked = useMemo(() => {
    const remembered = (pickedByDim[dimension] ?? []).filter((id) => available.has(id));
    const defaults = entities.slice(0, MIN_PICKED).map((entity) => entity.id);
    return (remembered.length > 0 ? remembered : defaults).slice(0, MAX_PICKED);
  }, [pickedByDim, dimension, available, entities]);

  const selectedEntities = entities.filter((entity) => picked.includes(entity.id));
  const compare =
    selectedEntities.length >= MIN_PICKED ? multiCompareOf(dimension, selectedEntities) : null;
  const labelOf = (id: string) => entities.find((entity) => entity.id === id)?.label ?? id;
  // 工具记录本身没有 usage（token 记在 assistant 调用上），按回合归因是另一个口径：
  // 工具维度直接不渲染 Token / 占比两列，而不是印一排 0。
  const showTokens = dimension !== "tool";

  const toggle = (id: string) => {
    setPickedByDim((current) => {
      const previous = (current[dimension] ?? picked).filter((entry) => available.has(entry));
      const next = previous.includes(id)
        ? previous.filter((entry) => entry !== id)
        : previous.length >= MAX_PICKED
          ? previous
          : [...previous, id];
      return { ...current, [dimension]: next };
    });
  };

  return (
    <Panel
      title="多选对照"
      ariaLabel="多选对照"
      actions={
        <>
          <SegmentedControl
            items={DIMENSION_ITEMS}
            value={dimension}
            onChange={(next) => setDimension(next)}
            ariaLabel="对照维度"
          />
          <ProvenanceBadge provenance="logged" />
        </>
      }
    >
      <div className={styles.multi} data-probe="multi-compare" data-dimension={dimension}>
        <div className={styles.pick} data-probe="multi-pick">
          {entities.length === 0 ? (
            <p className={styles.empty}>这一维没有读数</p>
          ) : (
            entities.map((entity) => {
              const selected = picked.includes(entity.id);
              const exhausted = !selected && picked.length >= MAX_PICKED;
              return (
                <button
                  key={entity.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={selected}
                  disabled={exhausted}
                  title={exhausted ? "最多选 4 个" : undefined}
                  data-probe="multi-chip"
                  data-entity={entity.id}
                  onClick={() => toggle(entity.id)}
                >
                  {entity.label}
                </button>
              );
            })
          )}
        </div>

        {compare ? (
          <table className={styles.table} data-probe="multi-table">
            <caption>{`按 ${DIMENSION_LABEL[dimension]}对照`}</caption>
            <thead>
              <tr>
                <th scope="col">实体</th>
                {showTokens ? <th scope="col">Token</th> : null}
                <th scope="col">会话</th>
                <th scope="col">消息</th>
                <th scope="col">错误</th>
                <th scope="col">活跃天</th>
                {showTokens ? <th scope="col">Token 占比</th> : null}
              </tr>
            </thead>
            <tbody>
              {compare.rows.map((row) => (
                <tr
                  key={row.id}
                  data-probe="multi-row"
                  data-entity={row.id}
                  className={compare.best?.id === row.id ? styles.bestRow : undefined}
                >
                  <th scope="row">
                    {row.label}
                    {showTokens && compare.best?.id === row.id ? (
                      <span className={styles.bestTag}>本组最重</span>
                    ) : null}
                  </th>
                  {showTokens ? (
                    <td className={styles.num}>{formatTokenCount(row.metrics.tokens)}</td>
                  ) : null}
                  <td className={styles.num}>{row.metrics.sessions.toLocaleString("en-US")}</td>
                  <td className={styles.num}>{formatTokenCount(row.metrics.messages)}</td>
                  <td className={styles.num}>{row.metrics.errors.toLocaleString("en-US")}</td>
                  <td className={styles.num}>{row.metrics.activeDays.toLocaleString("en-US")}</td>
                  {showTokens ? (
                    <td>
                      <span className={styles.shareCell}>
                        <span className={styles.shareBar} aria-hidden="true">
                          <span
                            className={styles.shareFill}
                            style={{ width: `${Math.round(row.shares.tokens * 100)}%` }}
                          />
                        </span>
                        <span className={styles.shareText}>
                          {(row.shares.tokens * 100).toFixed(1)}%
                        </span>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.empty}>
            {entities.length === 0 ? "这一维没有读数" : "再选 1 个就能对照"}
          </p>
        )}
      </div>
      <p className={styles.note}>
        最多选 4 个；占比按所选实体合计，不是全站。
        {showTokens && compare?.spread != null
          ? ` 组内差 ${Math.round(compare.spread * 100)}%。`
          : ""}
        {showTokens && compare?.best ? ` Token 最高：${labelOf(compare.best.id)}。` : ""}
        {showTokens ? "" : " 工具维度没有直接的 token 读数。"}
      </p>
    </Panel>
  );
}
