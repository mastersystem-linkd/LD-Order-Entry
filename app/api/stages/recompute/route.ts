import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db, dbx } from "@/lib/db";
import { plannedAtForOffset } from "@/lib/workflow";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

// POST /api/stages/recompute — re-derive planned_at for all NOT-yet-done stages
// of existing orders from the current SLA config (ADMIN). Lets orders created
// before an SLA change pick up the new offsets. Completed stages are untouched.
export async function POST() {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  try {
    const offRows = await db
      .select({
        stageKey: workflowStages.stageKey,
        off: workflowStages.plannedOffsetDays,
      })
      .from(workflowStages);
    const offsets = Object.fromEntries(offRows.map((r) => [r.stageKey, r.off]));

    // Not-done stage rows + their order's date.
    const rows = await db
      .select({
        id: lineStageProgress.id,
        stageKey: lineStageProgress.stageKey,
        orderDate: customerOrders.orderDate,
      })
      .from(lineStageProgress)
      .innerJoin(
        orderLineItems,
        eq(orderLineItems.id, lineStageProgress.orderLineItemId),
      )
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(eq(lineStageProgress.isDone, false));

    const now = new Date();
    let updated = 0;
    await dbx.transaction(async (tx) => {
      for (const r of rows) {
        const planned = plannedAtForOffset(r.orderDate, offsets[r.stageKey] ?? 1);
        await tx
          .update(lineStageProgress)
          .set({ plannedAt: planned, updatedAt: now })
          .where(eq(lineStageProgress.id, r.id));
        updated += 1;
      }
    });

    return jsonData({ recomputed: updated });
  } catch (e) {
    console.error("POST /api/stages/recompute failed:", e);
    return jsonError("Failed to recompute planned dates", 500);
  }
}
