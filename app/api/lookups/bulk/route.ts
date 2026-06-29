import { eq, inArray } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import {
  firstZodError,
  lookupBulkDeleteSchema,
  lookupBulkSchema,
} from "@/lib/validation";
import { lookupValues } from "@/db/schema";

// POST /api/lookups/bulk — paste many values (one per line) for a category.
// Idempotent: dedupes within the paste and against existing values, reactivates
// soft-deleted matches, and reports added vs skipped. ADMIN only.
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = lookupBulkSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { category, values } = parsed.data;

  // Clean + dedupe within the paste (case-insensitive, keep first spelling).
  const cleaned: string[] = [];
  const seenLower = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v || v.length > 200) continue;
    const lower = v.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    cleaned.push(v);
  }
  if (cleaned.length === 0) return jsonError("No usable values to import", 422);

  // Existing values in this category (any active state).
  const existing = await db
    .select({
      id: lookupValues.id,
      value: lookupValues.value,
      isActive: lookupValues.isActive,
    })
    .from(lookupValues)
    .where(eq(lookupValues.category, category));

  const existingByLower = new Map(
    existing.map((e) => [e.value.toLowerCase(), e]),
  );

  const toInsert: string[] = [];
  const toReactivate: string[] = [];
  let skipped = 0;

  for (const v of cleaned) {
    const match = existingByLower.get(v.toLowerCase());
    if (!match) {
      toInsert.push(v);
    } else if (!match.isActive) {
      toReactivate.push(match.id);
    } else {
      skipped += 1;
    }
  }

  if (toReactivate.length) {
    await db
      .update(lookupValues)
      .set({ isActive: true })
      .where(inArray(lookupValues.id, toReactivate));
  }
  if (toInsert.length) {
    await db
      .insert(lookupValues)
      .values(toInsert.map((value) => ({ category, value })))
      .onConflictDoNothing();
  }

  return jsonData({
    added: toInsert.length,
    reactivated: toReactivate.length,
    skipped,
    total: cleaned.length,
  });
}

// DELETE /api/lookups/bulk — remove many values at once by id. Soft-deletes
// (is_active=false) by default, or permanently with { hard: true }. ADMIN only.
// Lookups aren't FK-referenced (orders store party/fabric as text), so a hard
// delete is safe.
export async function DELETE(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = lookupBulkDeleteSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { ids, hard } = parsed.data;

  if (hard) {
    const deleted = await db
      .delete(lookupValues)
      .where(inArray(lookupValues.id, ids))
      .returning({ id: lookupValues.id });
    return jsonData({ deleted: deleted.length });
  }

  const updated = await db
    .update(lookupValues)
    .set({ isActive: false })
    .where(inArray(lookupValues.id, ids))
    .returning({ id: lookupValues.id });
  return jsonData({ deactivated: updated.length });
}
