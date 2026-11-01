import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { promptProfileOf } from "./promptProfile";
import styles from "./PromptProfilePanel.module.css";

/**
 * I5 提问画像（实验室档末尾，提示节奏之后）。
 *
 * 只数**用户**消息（`kind === "user"` 且不是压缩摘要）：助手的长回复不是
 * 「提问的形状」。三指标与五档长度条都来自模型，界面只负责格式化与
 * 「<3 条不给迷你条」这条诚实规则——两三条消息画出的形状会被读成趋势。
 */

const MIN_BARS = 3;

function percent(share: number | null): string {
  return share === null ? "—" : `${(share * 100).toFixed(1)}%`;
}

export function PromptProfilePanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
}) {
  const profile = useMemo(() => {
    const startTs = addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
    const messages = inputs.flatMap((input) =>
      input.records
        .filter(
          (record) =>
            record.kind === "user" &&
            !record.compactSummary &&
            record.timestamp >= startTs
        )
        .map((record) => ({ text: record.text }))
    );
    return promptProfileOf(messages);
  }, [inputs, days, now]);

  if (profile === null) {
    return (
      <Panel
        title="提问画像"
        ariaLabel="提问画像"
        actions={<ProvenanceBadge provenance="logged" />}
      >
        <p className={styles.empty} data-probe="prompt-profile">
          这个窗口里没有用户消息
        </p>
      </Panel>
    );
  }

  const total = profile.lengthBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

  return (
    <Panel
      title="提问画像"
      ariaLabel="提问画像"
      actions={<ProvenanceBadge provenance="logged" />}
    >
      <div className={styles.profile} data-probe="prompt-profile">
        <p className={styles.metrics}>
          <span className={styles.metric}>{`提问长度中位 ${
            profile.medianLength === null ? "—" : Math.round(profile.medianLength)
          } 字`}</span>
          <span className={styles.metric}>{`含代码块 ${percent(profile.codeBlockShare)}`}</span>
          <span className={styles.metric}>{`中文汉字占 ${percent(profile.cjkShare)}`}</span>
        </p>

        {profile.count < MIN_BARS ? (
          <p className={styles.empty}>
            {`只有 ${profile.count} 条提问，先看个大概`}
          </p>
        ) : (
          <div className={styles.mini} role="img" aria-label="提问长度分布">
            {profile.lengthBuckets.map((bucket) => (
              <span
                key={bucket.id}
                className={styles.segment}
                style={{ flexGrow: bucket.count, flexBasis: 0 }}
                title={`${bucket.label}：${bucket.count} 条`}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {profile.count >= MIN_BARS ? (
          <div className={styles.labels} aria-hidden="true">
            {profile.lengthBuckets.map((bucket) => (
              <span key={bucket.id} className={styles.label}>
                {bucket.label}
              </span>
            ))}
          </div>
        ) : null}

        <p className={styles.note}>
          只统计用户消息；代码块内容不计入字数与语言占比。
          {total > 0 && profile.count >= MIN_BARS ? ` 共 ${total} 条。` : ""}
        </p>
      </div>
    </Panel>
  );
}
