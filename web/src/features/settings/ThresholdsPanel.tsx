import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
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
  const isDefault = THRESHOLD_KEYS.every((key) => thresholds[key] === DEFAULT_THRESHOLDS[key]);

  return (
    <section className={styles.panel} aria-label="阈值设置">
      <header className={styles.header}>
        <h2>阈值设置</h2>
        <Button type="button" onClick={onClose}>
          关闭
        </Button>
      </header>
      <p className={styles.note}>
        控制报告与日志表的规模，改动立即生效并保存在本机。
      </p>
      <div className={styles.grid}>
        {THRESHOLD_KEYS.map((key) => (
          <ThresholdField key={key} thresholdKey={key} />
        ))}
      </div>
      <footer className={styles.footer}>
        <Button type="button" onClick={() => resetThresholds()} disabled={isDefault}>
          恢复默认
        </Button>
      </footer>
    </section>
  );
}
