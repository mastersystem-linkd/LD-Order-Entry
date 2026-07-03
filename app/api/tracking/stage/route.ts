import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { firstZodError, stageToggleSchema } from "@/lib/validation";
import { applyStageProgress, WorkflowError } from "@/lib/workflow";
import { orderLineItems } from "@/db/schema";

// PATCH /api/tracking/stage — tick/untick one stage on one line item (OE-P3).
// ADMIN + OPS only (SALES has no tracking; VIEWER is read-only). One transaction
// inside lib/workflow.ts: stamps actual + delay, advances the next stage's
// planned_at, and recomputes the line's operations status.
export async function PATCH(req: Request) {
  const guard = await requireCapability("operations.edit");
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = stageToggleSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { line_item_id, stage_key, checked, stock_status, planned, actual } =
    parsed.data;

  // Guard against a stage_key on a line that doesn't exist → clean 404.
  const [line] = await db
    .select({ id: orderLineItems.id })
    .from(orderLineItems)
    .where(eq(orderLineItems.id, line_item_id))
    .limit(1);
  if (!line) return jsonError("Line item not found", 404);

  try {
    const lineStatus = await applyStageProgress({
      orderLineItemId: line_item_id,
      stageKey: stage_key,
      isDone: checked,
      stockStatus: stock_status ?? null,
      plannedAt: planned === undefined ? undefined : planned ? new Date(planned) : null,
      actualAt: actual ? new Date(actual) : null,
      updatedBy: guard.user.email ?? guard.user.name ?? null,
    });

    return jsonData({
      line_item_id,
      stage_key,
      checked,
      stock_status: stock_status ?? null,
      line_status: lineStatus,
    });
  } catch (e) {
    // Sequencing-rule violations are user-facing (409); anything else is a 500.
    if (e instanceof WorkflowError) return jsonError(e.message, 409);
    console.error("PATCH /api/tracking/stage failed:", e);
    return jsonError("Failed to update stage", 500);
  }
}
