// Operations-stage logic lives ONLY here (CLAUDE.md §8): stage seeding on order
// save, operations-status derivation, the edit-time line-match key, and stage
// completion (tick/untick) for OE-P3.
import { eq } from "drizzle-orm";

import { dbx } from "@/lib/db";
import { lineStageProgress } from "@/db/schema";

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

// Sentence-case labels for the tracking UI (CLAUDE.md §8 conventions).
export const STAGE_LABELS: Record<StageKey, string> = {
  order_entry: "Order entry",
  stock_checking: "Stock checking",
  rolling_checking: "Rolling & checking",
  challan: "Challan",
  bill: "Bill",
  dispatch: "Dispatch",
  received_lr: "Received LR",
};

export type OperationsStatus = "COMPLETED" | "PARTIALLY COMPLETED" | "PENDING";

// A stage's planned deadline (§6, SLA): the order's date at 00:00 (UTC) plus
// that stage's planned_offset_days. Planned dates are config-driven — never the
// previous stage's finish time.
export function plannedAtForOffset(orderDate: string, offsetDays: number): Date {
  const d = new Date(`${orderDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

// The 7 stage-progress rows for a freshly created line (§6): all is_done=false,
// each stage's planned_at = order_date + its planned_offset_days (from the
// Time Tracking config in workflow_stages).
export function buildInitialStageRows(
  orderLineItemId: string,
  orderDate: string,
  offsets: Record<string, number>,
) {
  return STAGE_KEYS.map((stageKey) => ({
    orderLineItemId,
    stageKey,
    plannedAt: plannedAtForOffset(orderDate, offsets[stageKey] ?? 1),
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

// Delay in whole minutes between planned and actual (§6). Signed: positive =
// late, zero/negative = on time or early.
export function computeDelayMinutes(planned: Date | null, actual: Date): number {
  if (!planned) return 0;
  return Math.round((actual.getTime() - planned.getTime()) / 60000);
}

// Stage completion / un-tick for a single line item, in ONE transaction (§6):
//   check   → set actual (client value or now), is_done=true, compute delay,
//             and if the NEXT stage has no planned_at, set it to this actual_at.
//   uncheck → clear actual/done/delay (planned_at is left untouched).
// An optional `plannedAt` lets a caller (re)set the target stage's planned time.
// Returns the line's recomputed operations status.
export async function applyStageProgress(params: {
  orderLineItemId: string;
  stageKey: StageKey;
  isDone: boolean;
  plannedAt?: Date | null;
  actualAt?: Date | null;
  updatedBy?: string | null;
}): Promise<OperationsStatus> {
  const { orderLineItemId, stageKey, isDone, plannedAt, actualAt, updatedBy } =
    params;
  const now = new Date();

  return dbx.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(lineStageProgress)
      .where(eq(lineStageProgress.orderLineItemId, orderLineItemId));

    const target = rows.find((r) => r.stageKey === stageKey);
    if (!target) {
      throw new Error("Stage row not found for this line item.");
    }

    // Effective planned time for delay = an explicit override, else what's stored.
    const planned = plannedAt !== undefined ? plannedAt : target.plannedAt;

    if (isDone) {
      const actual = actualAt ?? now;
      // Planned date is config-driven (SLA) — completing a stage never changes
      // any stage's planned_at (§6).
      await tx
        .update(lineStageProgress)
        .set({
          plannedAt: planned,
          actualAt: actual,
          isDone: true,
          delayMinutes: computeDelayMinutes(planned, actual),
          updatedBy: updatedBy ?? null,
          updatedAt: now,
        })
        .where(eq(lineStageProgress.id, target.id));
    } else {
      await tx
        .update(lineStageProgress)
        .set({
          plannedAt: planned,
          actualAt: null,
          isDone: false,
          delayMinutes: null,
          updatedBy: updatedBy ?? null,
          updatedAt: now,
        })
        .where(eq(lineStageProgress.id, target.id));
    }

    const updated = await tx
      .select({ isDone: lineStageProgress.isDone })
      .from(lineStageProgress)
      .where(eq(lineStageProgress.orderLineItemId, orderLineItemId));

    return computeLineStatus(updated);
  });
}
