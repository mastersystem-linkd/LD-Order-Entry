import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { customerOrders } from "@/db/schema";

// GET /api/orders/check-no?orderNo=X — { available } for blur-time dup checks.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const orderNo = new URL(req.url).searchParams.get("orderNo")?.trim();
  if (!orderNo) return jsonError("orderNo is required");

  const [row] = await db
    .select({ id: customerOrders.id })
    .from(customerOrders)
    .where(eq(customerOrders.orderNo, orderNo))
    .limit(1);

  return jsonData({ orderNo, available: !row });
}
