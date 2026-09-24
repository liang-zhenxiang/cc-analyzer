import { useSyncExternalStore } from "react";

/** Tunable budgets that used to be hard-coded constants in three modules. */
export type Thresholds = {
  promptBytes: number;
  detailRows: number;
  slowTools: number;
  subagents: number;
  parseChunkLines: number;
  logWindowRows: number;
};

export type ThresholdKey = keyof Thresholds;

type ThresholdSpec = {
  label: string;
  hint: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Stored value -> value shown in the settings form. */
  toInput: (value: number) => number;
  /** Value from the settings form -> stored value. */
  fromInput: (value: number) => number;
};

const identity = (value: number) => value;

const KB = 1024;

export const THRESHOLD_SPECS: Record<ThresholdKey, ThresholdSpec> = {
  promptBytes: {
    label: "Prompt 上限",
    hint: "生成给 claude 的 prompt 总字节上限，超出时按优先级丢弃小节",
    unit: "KB",
    min: 16 * KB,
    max: 512 * KB,
    step: 8 * KB,
    toInput: (value) => Math.round(value / KB),
    fromInput: (value) => Math.round(value * KB)
  },
  detailRows: {
    label: "记录明细行数",
    hint: "报告「记录表」最多列出的条数，超出时按耗时降序截断",
    unit: "条",
    min: 50,
    max: 2000,
    step: 50,
    toInput: identity,
    fromInput: identity
  },
  slowTools: {
    label: "最慢工具条数",
    hint: "「最慢工具」小节列出多少条，其余只给聚合耗时",
    unit: "条",
    min: 1,
    max: 50,
    step: 1,
    toInput: identity,
    fromInput: identity
  },
  subagents: {
    label: "子 agent 条数",
    hint: "「子 agent 全量表」列出多少条",
    unit: "条",
    min: 1,
    max: 200,
    step: 1,
    toInput: identity,
    fromInput: identity
  },
  parseChunkLines: {
    label: "解析分块行数",
    hint: "异步解析每处理多少行让出一次主线程，行数越小界面越跟手",
    unit: "行",
    min: 200,
    max: 20000,
    step: 100,
    toInput: identity,
    fromInput: identity
  },
  logWindowRows: {
    label: "列表窗口行数",
    hint: "日志表 / 会话列表超过多少行开始只渲染可视区域",
    unit: "行",
    min: 20,
    max: 2000,
    step: 20,
    toInput: identity,
    fromInput: identity
  }
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  promptBytes: 96 * KB,
  detailRows: 300,
  slowTools: 10,
  subagents: 30,
  parseChunkLines: 2000,
  logWindowRows: 120
};

export const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS) as ThresholdKey[];

const STORAGE_KEY = "cca-thresholds";

export function clampThresholds(raw: unknown): Thresholds {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const next = { ...DEFAULT_THRESHOLDS };
  for (const key of THRESHOLD_KEYS) {
    const rawValue = source[key];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const { min, max } = THRESHOLD_SPECS[key];
    next[key] = Math.min(max, Math.max(min, value));
  }
  return next;
}

/** Reads the persisted thresholds, falling back to the defaults. */
export function loadThresholds(storage: Pick<Storage, "getItem"> = localStorage): Thresholds {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    return clampThresholds(JSON.parse(raw));
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

let current: Thresholds | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Current thresholds; the same object reference until they change. */
export function getThresholds(): Thresholds {
  current ??= loadThresholds();
  return current;
}

export function subscribeThresholds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setThresholds(patch: Partial<Thresholds>): Thresholds {
  current = clampThresholds({ ...getThresholds(), ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage is optional; the in-memory value still applies.
  }
  notify();
  return current;
}

export function setThreshold<K extends ThresholdKey>(key: K, value: number): Thresholds {
  const patch = { [key]: value } as Pick<Thresholds, K>;
  return setThresholds(patch);
}

export function resetThresholds(): Thresholds {
  current = DEFAULT_THRESHOLDS;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
  notify();
  return current;
}

export function useThresholds(): Thresholds {
  return useSyncExternalStore(subscribeThresholds, getThresholds, getThresholds);
}
