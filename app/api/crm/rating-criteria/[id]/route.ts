import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { crmRatingCriteria } from "@/db/schema";
import { firstZodError, ratingCriterionUpdateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/crm/rating-criteria/:id — re-word, re-order, retire or restore.
// `key` is never editable: scores in crm_followup_ratings reference it, and
// changing it would orphan every score already given.
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = ratingCriterionUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const [target] = await db
    .select()
    .from(crmRatingCriteria)
    .where(eq(crmRatingCriteria.id, id))
    .limit(1);
  if (!target) return jsonError("Criterion not found", 404);

  const d = parsed.data;
  const patch: Partial<typeof crmRatingCriteria.$inferInsert> = {};
  if (d.label !== undefined) patch.label = d.label;
  if (d.hint !== undefined) patch.hint = d.hint;
  if (d.sort_order !== undefined) patch.sortOrder = d.sort_order;
  if (d.is_active !== undefined) {
    // Refuse to retire the last one: with none active the call panel has no
    // ratings at all, and a follow-up cannot be completed without an overall.
    if (d.is_active === false) {
      const active = await db.select().from(crmRatingCriteria);
      const remaining = active.filter((r) => r.isActive && r.id !== id).length;
      if (remaining === 0) {
        return jsonError(
          "At least one rating criterion must stay active — the call panel needs something to score.",
          409,
        );
      }
    }
    patch.isActive = d.is_active;
  }

  await db.update(crmRatingCriteria).set(patch).where(eq(crmRatingCriteria.id, id));
  return jsonData({ id });
}

// DELETE /api/crm/rating-criteria/:id — retire it. Deliberately a soft
// retire, never a hard delete: scores already given reference this key, and
// removing the row would leave them unlabelled. Same reasoning as a
// deactivated dropdown value that still reads correctly on old orders.
export async function DELETE(_req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const rows = await db.select().from(crmRatingCriteria);
  const target = rows.find((r) => r.id === id);
  if (!target) return jsonError("Criterion not found", 404);
  if (rows.filter((r) => r.isActive && r.id !== id).length === 0) {
    return jsonError(
      "At least one rating criterion must stay active — the call panel needs something to score.",
      409,
    );
  }

  await db
    .update(crmRatingCriteria)
    .set({ isActive: false })
    .where(eq(crmRatingCriteria.id, id));
  return jsonData({ id, retired: true });
}
