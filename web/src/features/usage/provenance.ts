/**
 * Where a number on the dashboard comes from. The three tiers are the design
 * language for "honest instrumentation": every figure says whether it was read
 * from the log, estimated against the pricing snapshot, or is snapshot
 * metadata itself.
 */
export type Provenance = "logged" | "estimated" | "snapshot";

/** Chinese label per tier; callers append detail like the snapshot date. */
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  logged: "读自日志",
  estimated: "按定价快照估算",
  snapshot: "定价快照"
};
