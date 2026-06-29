import { asc, eq } from "drizzle-orm";

import { jsonData, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { orderLineItems } from "@/db/schema";

// GET /api/designs?fabric=X — distinct design numbers from past line items
// (optionally scoped to a fabric). Suggestions only; never blocks free text.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const fabric = new URL(req.url).searchParams.get("fabric")?.trim();

  const rows = await db
    .selectDistinct({ design: orderLineItems.designNo })
    .from(orderLineItems)
    .where(fabric ? eq(orderLineItems.quality, fabric) : undefined)
    .orderBy(asc(orderLineItems.designNo));

  return jsonData(rows.map((r) => r.design));
}
