import { useSyncExternalStore } from "react";

/**
 * Subscription plan presets for the billing-window gauge.
 *
 * The numbers are **community estimates compiled from public sources**
 * (primarily Claude-Code-Usage-Monitor's plan model) — Anthropic does not
 * publish per-window token limits, so these are `estimated`, never presented
 * as official figures, and a custom value is always one click away. No plan
 * selected means no denominator, and without a denominator the UI shows
 * consumption only — never a made-up percentage.
 */
export const PLAN_LIMITS_AS_OF = "2026-10";

export type PlanId = "none" | "pro" | "max5" | "max20" | "team" | "custom";

export type PlanSelection = {
  id: PlanId;
  /** Tokens per 5h billing window; `null` when unknown or "none". */
  limitTokens: number | null;
  /** Tokens per rolling 7 days; `null` when unset — which is always the case for presets. */
  weeklyLimitTokens: number | null;
};

export const PLAN_PRESETS: ReadonlyArray<{
  id: PlanId;
  label: string;
  limitTokens: number | null;
  /**
   * Presets never carry a weekly figure: the 5h numbers at least have a
   * community compilation behind them, but no reliable source exists for the
   * weekly tier — an invented "plausible" number is worse than none. The
   * weekly denominator is therefore always the user's own (settings input).
   */
  weeklyLimitTokens: null;
}> = [
  { id: "none", label: "不选（只看消耗）", limitTokens: null, weeklyLimitTokens: null },
  { id: "pro", label: "Pro（约 1.9 万 / 窗口）", limitTokens: 19_000, weeklyLimitTokens: null },
  { id: "max5", label: "Max 5×（约 8.8 万 / 窗口）", limitTokens: 88_000, weeklyLimitTokens: null },
  { id: "max20", label: "Max 20×（约 22 万 / 窗口）", limitTokens: 220_000, weeklyLimitTokens: null },
  { id: "team", label: "Team（自定上限）", limitTokens: null, weeklyLimitTokens: null },
  { id: "custom", label: "自定义", limitTokens: null, weeklyLimitTokens: null }
];

const STORAGE_KEY = "cca-billing-plan";

const VALID_IDS: ReadonlySet<string> = new Set([
  ...PLAN_PRESETS.map((preset) => preset.id),
  "custom"
]);

/** Parses persisted state; anything malformed falls back to "none". */
export function parsePlanSelection(raw: unknown): PlanSelection {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = source.id;
  // has() 不做类型收窄：字符串过了白名单后显式当作 PlanId（集合就是全集）。
  if (typeof id !== "string" || !VALID_IDS.has(id)) {
    return { id: "none", limitTokens: null, weeklyLimitTokens: null };
  }
  const planId = id as PlanId;
  const custom = Number(source.customLimitTokens);
  // 周预算与计划档位正交（预设一律没有周数字），任何档位下都只认使用者自设的值；
  // 旧持久化里没有这个字段 → Number(undefined) = NaN → null，界面退回只显示消耗。
  const weekly = Number(source.customWeeklyLimitTokens);
  const weeklyLimitTokens =
    Number.isFinite(weekly) && weekly > 0 ? Math.round(weekly) : null;
  if (id === "custom") {
    return {
      id: planId,
      limitTokens: Number.isFinite(custom) && custom > 0 ? Math.round(custom) : null,
      weeklyLimitTokens
    };
  }
  if (id === "team") {
    return {
      id: planId,
      limitTokens: Number.isFinite(custom) && custom > 0 ? Math.round(custom) : null,
      weeklyLimitTokens
    };
  }
  const preset = PLAN_PRESETS.find((item) => item.id === planId);
  return { id: planId, limitTokens: preset ? preset.limitTokens : null, weeklyLimitTokens };
}

function loadPlan(): PlanSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { id: "none", limitTokens: null, weeklyLimitTokens: null };
    return parsePlanSelection(JSON.parse(raw));
  } catch {
    return { id: "none", limitTokens: null, weeklyLimitTokens: null };
  }
}

let current: PlanSelection | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getPlan(): PlanSelection {
  current ??= loadPlan();
  return current;
}

export function setPlan(next: PlanSelection): void {
  current = next;
  try {
    // 持久化按解析契约写「custom*」字段（解析只认这两个名字）。
    // 此前直接序列化 selection 本身，自设的 5h 数字重启后读不回来——
    // 周预算沿用同一份 JSON，必须先把这条往返修通。
    const raw = JSON.stringify({
      id: next.id,
      customLimitTokens: next.limitTokens,
      customWeeklyLimitTokens: next.weeklyLimitTokens
    });
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Persistence is optional; the in-memory selection still works.
  }
  notify();
}

export function subscribePlan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlan(): PlanSelection {
  return useSyncExternalStore(subscribePlan, getPlan);
}
