import { and, asc, eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { LOOKUP_CATEGORIES, lookupValues } from "@/db/schema";

// GET /api/lookups?category=PARTY|SALES_PERSON|AGENT|HASTE|TRANSPORT|FABRIC
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const category = new URL(req.url).searchParams.get("category");
  if (!category || !(LOOKUP_CATEGORIES as readonly string[]).includes(category)) {
    return jsonError("Unknown or missing category");
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
