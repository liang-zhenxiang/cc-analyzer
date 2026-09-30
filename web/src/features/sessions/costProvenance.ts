import type { TokenTotals } from "./tokenTotals";

/**
 * Where a cost figure would come from — which today means saying why there is none.
 *
 * The panel shows the four token counters and no dollar amount. A price needs a
 * price table, and this app ships none: the table could not be fetched at
 * runtime (session data does not leave the machine), and for the third-party
 * routed models these sessions actually run on there is no authoritative
 * offline source to bundle. Printing `$0.0000`, or leaving the field blank,
 * would each read as a fact — and a wrong one — so the panel states the gap
 * instead.
 *
 * The `official` / `local_estimate` ladder from the research report is
 * deliberately absent rather than stubbed: with no price table every session
 * lands on the same rung, and a one-branch ladder is decoration. Add the levels
 * when a price table makes them mean something.
 */
export type CostProvenance = {
  /** Badge text, read as `label · reason`. */
  label: string;
  reason: string;
};

export function costProvenanceOf(totals: TokenTotals): CostProvenance {
  if (totals.total === 0) {
    return { label: "成本未知", reason: "本次会话没有 token 记录" };
  }
  return { label: "成本未知", reason: "未收录该模型定价" };
}
