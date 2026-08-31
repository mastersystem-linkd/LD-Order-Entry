import { asc, eq } from "drizzle-orm";

import {
  isUniqueViolation,
  jsonData,
  jsonError,
  requireCapability,
  requireRole,
} from "@/lib/api";
import { db } from "@/lib/db";
import { crmRatingCriteria } from "@/db/schema";
import {
  firstZodError,
  ratingCriterionCreateSchema,
} from "@/lib/validation";

// What a delivered order is scored on (CLAUDE.md §12.4). These were four fixed
// columns until migration 0005; they are rows now so the business can change
// what it measures without a deploy.
//
// READ is crm.view, not ADMIN: the call panel needs the list to render its
// star rows. WRITES are ADMIN, like every other Settings surface.

function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "criterion"
  );
}

// GET /api/crm/rating-criteria — ?all=1 includes retired ones (Settings).
export async function GET(req: Request) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  const all = new URL(req.url).searchParams.get("all") === "1";
  const rows = await db
    .select()
    .from(crmRatingCriteria)
    .orderBy(asc(crmRatingCriteria.sortOrder), asc(crmRatingCriteria.label));

  return jsonData(
    rows
      .filter((r) => all || r.isActive)
      .map((r) => ({
        id: r.id,
        key: r.key,
        label: r.label,
        hint: r.hint,
        sort_order: r.sortOrder,
        is_active: r.isActive,
      })),
  );
}

// POST /api/crm/rating-criteria — add one (ADMIN).
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = ratingCriterionCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const { label, hint } = parsed.data;

  // The key is derived once and then frozen: scores reference it, so a later
  // re-wording of the label must not detach the history behind it.
  const key = parsed.data.key?.trim() || slugify(label);

  const existing = await db.select().from(crmRatingCriteria);
  if (existing.some((r) => r.key === key)) {
    // A retired criterion coming back should resume its old scores, not
    // become a second column that looks identical.
    const prior = existing.find((r) => r.key === key)!;
    if (!prior.isActive) {
      await db
        .update(crmRatingCriteria)
        .set({ isActive: true, label, hint: hint ?? null })
        .where(eq(crmRatingCriteria.id, prior.id));
      return jsonData({ id: prior.id, key, label, reactivated: true }, 200);
    }
    return jsonError(`"${label}" is already a rating criterion.`, 409);
  }

  const sortOrder =
    existing.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1;

  try {
    const [created] = await db
      .insert(crmRatingCriteria)
      .values({ key, label, hint: hint ?? null, sortOrder })
      .returning({ id: crmRatingCriteria.id });
    return jsonData({ id: created.id, key, label, sort_order: sortOrder }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return jsonError(`"${label}" is already a rating criterion.`, 409);
    }
    console.error("POST /api/crm/rating-criteria failed:", e);
    return jsonError("Could not add the criterion", 500);
  }
}
