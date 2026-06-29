import { inArray } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { designDatabase } from "@/db/schema";

// POST /api/design-database/bulk-delete — delete many log rows at once (ADMIN).
// Body: { ids: string[] }.
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const ids = Array.isArray((body as { ids?: unknown })?.ids)
    ? ((body as { ids: unknown[] }).ids.filter(
        (x) => typeof x === "string",
      ) as string[])
    : [];
  if (ids.length === 0) return jsonError("No ids provided", 422);

  const deleted = await db
    .delete(designDatabase)
    .where(inArray(designDatabase.id, ids))
    .returning({ id: designDatabase.id });

  return jsonData({ deleted: deleted.length });
}
