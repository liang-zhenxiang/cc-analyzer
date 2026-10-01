/**
 * Where a number on the dashboard comes from. The four tiers are the design
 * language for "honest instrumentation": every figure says whether it was read
 * from the log, estimated against the pricing snapshot, is snapshot metadata
 * itself, or was extrapolated from the user's own consumption speed.
 *
 * `inferred` exists because the billing window extrapolates — burning-rate and
 * ETA figures have nothing to do with the pricing snapshot, and labelling them
 * "估算" (the pricing tier) would say the wrong thing about the wrong source.
 */
export type Provenance = "logged" | "estimated" | "snapshot" | "inferred";

/** Chinese label per tier; callers append detail like the snapshot date. */
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  logged: "读自日志",
  estimated: "按定价快照估算",
  snapshot: "定价快照",
  inferred: "按消耗速度推算"
};
