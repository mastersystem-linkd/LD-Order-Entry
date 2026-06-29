// Operations-stage logic lives ONLY here (CLAUDE.md §8). Stage seeding on order
// save, operations-status derivation, and the edit-time line-match key.
// Stage completion (tick/untick) is added in OE-P3.

export const STAGE_KEYS = [
  "order_entry",
  "stock_checking",
  "rolling_checking",
  "challan",
  "bill",
  "dispatch",
  "received_lr",
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

export type OperationsStatus = "COMPLETED" | "PARTIALLY COMPLETED" | "PENDING";

// The 7 stage-progress rows for a freshly created line (§6): all is_done=false,
// order_entry.planned_at = creation time, the rest null.
export function buildInitialStageRows(orderLineItemId: string, now: Date) {
  return STAGE_KEYS.map((stageKey) => ({
    orderLineItemId,
    stageKey,
    plannedAt: stageKey === "order_entry" ? now : null,
    actualAt: null,
    isDone: false,
    delayMinutes: null,
  }));
}

// Per-line operations status (§6): all done → COMPLETED, some → PARTIALLY, none → PENDING.
export function computeLineStatus(
  stages: { isDone: boolean }[],
): OperationsStatus {
  if (stages.length === 0) return "PENDING";
  const done = stages.filter((s) => s.isDone).length;
  if (done === 0) return "PENDING";
  if (done === stages.length) return "COMPLETED";
  return "PARTIALLY COMPLETED";
}

// Order-level status = roll-up of its (non-cancelled) lines.
export function computeOrderStatus(
  lineStatuses: OperationsStatus[],
): OperationsStatus {
  if (lineStatuses.length === 0) return "PENDING";
  if (lineStatuses.every((s) => s === "COMPLETED")) return "COMPLETED";
  if (lineStatuses.every((s) => s === "PENDING")) return "PENDING";
  return "PARTIALLY COMPLETED";
}

// Identity used to preserve stage progress across an edit (§6): fabric + design
// + qty. Normalized so "10" and "10.00" (and case/space) match.
export function lineMatchKey(parts: {
  quality: string;
  designNo: string;
  qtyMtr: string | number;
}): string {
  return [
    parts.quality.trim().toLowerCase(),
    parts.designNo.trim().toLowerCase(),
    Number(parts.qtyMtr),
  ].join("|");
}
