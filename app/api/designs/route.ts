import { desc, eq } from "drizzle-orm";

import { jsonData, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { designDatabase } from "@/db/schema";

// GET /api/designs?fabric=X — distinct design numbers from the Design Database
// (CLAUDE.md §4), most-recent first, optionally scoped to a fabric. With no
// fabric, returns recent designs across all. Suggestions only; never blocks.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const fabric = new URL(req.url).searchParams.get("fabric")?.trim();

  const rows = await db
    .select({
      design: designDatabase.designNo,
      createdAt: designDatabase.createdAt,
    })
    .from(designDatabase)
    .where(fabric ? eq(designDatabase.fabricName, fabric) : undefined)
    .orderBy(desc(designDatabase.createdAt))
    .limit(300);

  // Dedupe design_no preserving most-recent-first order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!seen.has(r.design)) {
      seen.add(r.design);
      out.push(r.design);
    }
    if (out.length >= 50) break;
  }

  return jsonData(out);
}
