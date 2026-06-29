import { and, asc, eq } from "drizzle-orm";

import { isUniqueViolation, jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { firstZodError, lookupCreateSchema } from "@/lib/validation";
import { LOOKUP_CATEGORIES, lookupValues } from "@/db/schema";

// GET /api/lookups?category=…  — autocomplete source for the form (all roles,
// active values only) or, with ?all=1, the full Dropdown Master list incl.
// inactive + ids for the admin Settings manager.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const includeAll = url.searchParams.get("all") === "1";
  if (!category || !(LOOKUP_CATEGORIES as readonly string[]).includes(category)) {
    return jsonError("Unknown or missing category");
  }

  if (includeAll) {
    if (guard.user.role !== "ADMIN") return jsonError("Forbidden", 403);
    const rows = await db
      .select({
        id: lookupValues.id,
        category: lookupValues.category,
        value: lookupValues.value,
        is_active: lookupValues.isActive,
      })
      .from(lookupValues)
      .where(eq(lookupValues.category, category))
      .orderBy(asc(lookupValues.value));
    return jsonData(rows);
  }

  const rows = await db
    .select({ value: lookupValues.value })
    .from(lookupValues)
    .where(
      and(eq(lookupValues.category, category), eq(lookupValues.isActive, true)),
    )
    .orderBy(asc(lookupValues.value));

  return jsonData(rows.map((r) => r.value));
}

// POST /api/lookups — add a Dropdown Master value (ADMIN).
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = lookupCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { category, value } = parsed.data;

  // Reactivate a soft-deleted duplicate rather than creating a second row.
  const [existing] = await db
    .select({ id: lookupValues.id, isActive: lookupValues.isActive })
    .from(lookupValues)
    .where(and(eq(lookupValues.category, category), eq(lookupValues.value, value)))
    .limit(1);
  if (existing) {
    if (!existing.isActive) {
      await db
        .update(lookupValues)
        .set({ isActive: true })
        .where(eq(lookupValues.id, existing.id));
    }
    return jsonData({ id: existing.id, category, value, is_active: true }, 200);
  }

  try {
    const [created] = await db
      .insert(lookupValues)
      .values({ category, value })
      .returning({ id: lookupValues.id });
    return jsonData({ id: created.id, category, value, is_active: true }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return jsonError("Value already exists", 409);
    console.error("POST /api/lookups failed:", e);
    return jsonError("Failed to add value", 500);
  }
}
