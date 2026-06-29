import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { firstZodError, stageUpdateSchema } from "@/lib/validation";
import { STAGE_KEYS } from "@/lib/workflow";
import { workflowStages } from "@/db/schema";

type Params = { params: Promise<{ stage_key: string }> };

// PATCH /api/stages/:stage_key — edit a stage's planned_offset_days (ADMIN).
// Applies to NEW orders (and to open orders if the recompute action is run).
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { stage_key } = await params;

  if (!(STAGE_KEYS as readonly string[]).includes(stage_key)) {
    return jsonError("Unknown stage", 404);
  }

  const body = await req.json().catch(() => null);
  const parsed = stageUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  await db
    .update(workflowStages)
    .set({ plannedOffsetDays: parsed.data.planned_offset_days })
    .where(eq(workflowStages.stageKey, stage_key));

  return jsonData({
    stage_key,
    planned_offset_days: parsed.data.planned_offset_days,
  });
}
