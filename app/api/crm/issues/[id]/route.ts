import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { issueUpdateSchema, firstZodError } from "@/lib/validation";
import { crmIssues } from "@/db/schema";

// PATCH /api/crm/issues/:id — triage and resolve.
//
// Logging complaints without closing them is worse than not logging them, so
// RESOLVED requires a resolution (enforced by the schema) and stamps who closed
// it and when.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability("crm.edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = issueUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const p = parsed.data;

  try {
    const existing = await db
      .select()
      .from(crmIssues)
      .where(eq(crmIssues.id, id))
      .limit(1);
    const cur = existing[0];
    if (!cur) return jsonError("Issue not found", 404);

    const status = p.status ?? cur.status;
    const closing =
      (status === "RESOLVED" || status === "REJECTED") &&
      cur.status !== "RESOLVED" &&
      cur.status !== "REJECTED";

    const [updated] = await db
      .update(crmIssues)
      .set({
        category: p.category ?? cur.category,
        severity: p.severity ?? cur.severity,
        ownerDept: p.owner_dept !== undefined ? p.owner_dept : cur.ownerDept,
        qtyAffected:
          p.qty_affected !== undefined
            ? p.qty_affected != null
              ? String(p.qty_affected)
              : null
            : cur.qtyAffected,
        description: p.description !== undefined ? p.description : cur.description,
        status,
        resolution: p.resolution !== undefined ? p.resolution : cur.resolution,
        resolutionNote:
          p.resolution_note !== undefined ? p.resolution_note : cur.resolutionNote,
        resolvedAt: closing ? new Date() : cur.resolvedAt,
        resolvedBy: closing
          ? (guard.user.email ?? guard.user.name ?? null)
          : cur.resolvedBy,
        updatedAt: new Date(),
      })
      .where(eq(crmIssues.id, id))
      .returning();

    return jsonData(updated);
  } catch (e) {
    console.error("PATCH /api/crm/issues/[id] failed:", e);
    return jsonError("Could not save the issue", 500);
  }
}
