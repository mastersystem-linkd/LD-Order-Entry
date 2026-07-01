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

// Stock outcome recorded on the stock_checking stage. 'in_stock' completes it
// and unlocks downstream stages; 'out_of_stock' records the block.
export type StockStatus = "in_stock" | "out_of_stock";

// Thrown when a stage change breaks the sequencing rules (fully sequential;
// downgrades blocked while later stages are done). The API maps it to a 409
// with the message surfaced to the user.
export class WorkflowError extends Error {}

// Position of each stage in the fixed 7-stage order, for prerequisite checks.
const STAGE_INDEX: Record<string, number> = Object.fromEntries(
  STAGE_KEYS.map((k, i) => [k, i]),
);

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

// Stage completion / un-tick for a single line item, in ONE transaction (§6).
// Gating is STOCK-ONLY: Order entry and Stock checking have no prerequisite;
// the stages AFTER stock checking (Rolling, Challan, Bill, Dispatch, Received
// LR) can be completed only once stock is 'in_stock' — in any order among
// themselves (no step-by-step sequencing). Any stage may be un-completed at any
// time (no downgrade block). For stock_checking, `stockStatus` drives it:
// 'in_stock' completes the stage (unlocking downstream), 'out_of_stock'/null
// leaves it incomplete. Reverting stock does NOT clear stages already completed
// after it — they stay done and the line drops to PARTIALLY COMPLETED (the UI
// flags this with a confirm popup). Violations throw WorkflowError. Returns the
// recomputed line status.
export async function applyStageProgress(params: {
  orderLineItemId: string;
  stageKey: StageKey;
  isDone: boolean;
  stockStatus?: StockStatus | null;
  plannedAt?: Date | null;
  actualAt?: Date | null;
  updatedBy?: string | null;
}): Promise<OperationsStatus> {
  const {
    orderLineItemId,
    stageKey,
    isDone,
    stockStatus,
    plannedAt,
    actualAt,
    updatedBy,
  } = params;
  const now = new Date();
  const idx = STAGE_INDEX[stageKey];
  const isStock = stageKey === "stock_checking";

  // Stock completes only when 'in_stock'; every other stage uses `isDone`.
  const becomingDone = isStock ? stockStatus === "in_stock" : isDone;
  const nextStock: StockStatus | null = isStock
    ? becomingDone
      ? "in_stock"
      : (stockStatus ?? null)
    : null;

  return dbx.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(lineStageProgress)
      .where(eq(lineStageProgress.orderLineItemId, orderLineItemId));

    const target = rows.find((r) => r.stageKey === stageKey);
    if (!target) {
      throw new Error("Stage row not found for this line item.");
    }
    const byKey = new Map(rows.map((r) => [r.stageKey, r]));

    // --- Gating rule (stock-only) ---
    // The only prerequisite in the workflow is stock: a stage AFTER stock
    // checking can be completed only once stock is 'in_stock'. Order entry and
    // stock checking have none, and un-completing is always allowed.
    if (becomingDone && idx > STAGE_INDEX.stock_checking) {
      if (!byKey.get("stock_checking")?.isDone) {
        throw new WorkflowError(
          `Set "${STAGE_LABELS.stock_checking}" to In stock first.`,
        );
      }
    }

    // Effective planned time for delay = an explicit override, else what's stored.
    const planned = plannedAt !== undefined ? plannedAt : target.plannedAt;
    const actual = becomingDone ? (actualAt ?? now) : null;

    // Planned date is config-driven (SLA) — completing a stage never changes
    // any stage's planned_at (§6).
    await tx
      .update(lineStageProgress)
      .set({
        plannedAt: planned,
        actualAt: actual,
        isDone: becomingDone,
        delayMinutes: becomingDone
          ? computeDelayMinutes(planned, actual as Date)
          : null,
        stockStatus: isStock ? nextStock : target.stockStatus,
        updatedBy: updatedBy ?? null,
        updatedAt: now,
      })
      .where(eq(lineStageProgress.id, target.id));

    const updated = await tx
      .select({ isDone: lineStageProgress.isDone })
      .from(lineStageProgress)
      .where(eq(lineStageProgress.orderLineItemId, orderLineItemId));

    return computeLineStatus(updated);
  });
}
