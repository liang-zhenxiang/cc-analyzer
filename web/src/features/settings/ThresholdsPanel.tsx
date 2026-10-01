import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { TextInput } from "../../components/TextInput";
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_KEYS,
  THRESHOLD_SPECS,
  resetThresholds,
  setThreshold,
  useThresholds,
  type ThresholdKey
} from "./thresholds";
import { PLAN_PRESETS, setPlan, usePlan, type PlanId } from "../usage/planLimits";
import styles from "./ThresholdsPanel.module.css";

function ThresholdField({ thresholdKey }: { thresholdKey: ThresholdKey }) {
  const thresholds = useThresholds();
  const spec = THRESHOLD_SPECS[thresholdKey];
  const stored = spec.toInput(thresholds[thresholdKey]);
  const [draft, setDraft] = useState(String(stored));
  const [focused, setFocused] = useState(false);

  // Keep the box in sync with the store, but never rewrite what is being typed.
  useEffect(() => {
    if (!focused) setDraft(String(stored));
  }, [focused, stored]);

  return (
    <label className={styles.field}>
      <span className={styles.label}>{spec.label}</span>
      <span className={styles.control}>
        <TextInput
          type="number"
          aria-label={spec.label}
          min={spec.toInput(spec.min)}
          max={spec.toInput(spec.max)}
          step={spec.toInput(spec.step)}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(String(stored));
          }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            if (text === "") return;
            const value = spec.fromInput(Number(text));
            if (Number.isFinite(value)) setThreshold(thresholdKey, value);
          }}
        />
        <span className={styles.unit}>{spec.unit}</span>
      </span>
      <span className={styles.hint}>{spec.hint}</span>
    </label>
  );
}

export function ThresholdsPanel({ onClose }: { onClose: () => void }) {
  const thresholds = useThresholds();
  const plan = usePlan();
  const isDefault = THRESHOLD_KEYS.every((key) => thresholds[key] === DEFAULT_THRESHOLDS[key]);
  const [customDraft, setCustomDraft] = useState(String(plan.limitTokens ?? ""));
  const [customFocused, setCustomFocused] = useState(false);

  useEffect(() => {
    if (!customFocused) setCustomDraft(String(plan.limitTokens ?? ""));
  }, [customFocused, plan.limitTokens]);

  return (
    <section className={styles.panel} aria-label="阈值设置">
      <header className={styles.header}>
        <h2>阈值设置</h2>
        <IconButton label="关闭" onClick={onClose}>
          <Icon name="close" size={16} />
        </IconButton>
      </header>
      <p className={styles.note}>
        控制报告与日志表的规模，改动立即生效并保存在本机。
      </p>
      <div className={styles.grid}>
        {THRESHOLD_KEYS.map((key) => (
          <ThresholdField key={key} thresholdKey={key} />
        ))}
      </div>
      <h3 className={styles.sectionTitle}>计费窗口</h3>
      <p className={styles.note}>
        订阅计划决定「用量总览」里 5 小时窗口的限额刻度。限额是社区整理的
        估算值（非官方），选「不选」则只看消耗、不显示百分比。
      </p>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>订阅计划</span>
          <span className={styles.control}>
            <select
              aria-label="订阅计划"
              className={styles.select}
              value={plan.id}
              onChange={(event) => {
                const id = event.target.value as PlanId;
                const preset = PLAN_PRESETS.find((item) => item.id === id);
                setPlan({ id, limitTokens: preset ? preset.limitTokens : null });
              }}
            >
              {PLAN_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </span>
          <span className={styles.hint}>Team 与自定义在下一栏填每窗口上限。</span>
        </label>
        {(plan.id === "team" || plan.id === "custom") ? (
          <label className={styles.field}>
            <span className={styles.label}>每窗口上限（tokens）</span>
            <span className={styles.control}>
              <TextInput
                type="number"
                aria-label="每窗口上限（tokens）"
                min={1000}
                step={1000}
                value={customDraft}
                onFocus={() => setCustomFocused(true)}
                onBlur={() => {
                  setCustomFocused(false);
                  setCustomDraft(String(plan.limitTokens ?? ""));
                }}
                onChange={(event) => {
                  const text = event.target.value;
                  setCustomDraft(text);
                  const value = Number(text);
                  if (text !== "" && Number.isFinite(value) && value > 0) {
                    setPlan({ id: plan.id, limitTokens: Math.round(value) });
                  }
                }}
              />
              <span className={styles.unit}>tok/5h</span>
            </span>
            <span className={styles.hint}>四舍五入到整数；留空表示不设上限。</span>
          </label>
        ) : null}
      </div>
      <footer className={styles.footer}>
        <Button type="button" onClick={() => resetThresholds()} disabled={isDefault}>
          恢复默认
        </Button>
      </footer>
    </section>
  );
}
