import { asc } from "drizzle-orm";

import { jsonData, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { workflowStages } from "@/db/schema";

// GET /api/stages — the 7 workflow stages + their SLA offset (ADMIN, Settings →
// Time tracking).
export async function GET() {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const rows = await db
    .select({
      stage_key: workflowStages.stageKey,
      label: workflowStages.label,
      sort_order: workflowStages.sortOrder,
      planned_offset_days: workflowStages.plannedOffsetDays,
    })
    .from(workflowStages)
    .orderBy(asc(workflowStages.sortOrder));

  return jsonData(rows);
}
