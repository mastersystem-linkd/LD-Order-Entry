import { and, eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db, dbx } from "@/lib/db";
import { cancelOrderSchema, firstZodError } from "@/lib/validation";
import { isOrderCancelled } from "@/lib/workflow";
import { customerOrders, orderLineItems } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/orders/:id/cancel — cancel/restore a single design (line_id) or the
// whole order (line_id omitted). Reversible; never deletes stage progress, so a
// restored design keeps its prior tracking. orders.edit only.
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireCapability("orders.edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = cancelOrderSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const { line_id, cancelled } = parsed.data;

  const [order] = await db
    .select({ id: customerOrders.id })
    .from(customerOrders)
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!order) return jsonError("Order not found", 404);

  if (line_id) {
    const [line] = await db
      .select({ id: orderLineItems.id })
      .from(orderLineItems)
      .where(and(eq(orderLineItems.id, line_id), eq(orderLineItems.orderId, id)))
      .limit(1);
    if (!line) return jsonError("Design not found on this order", 404);
  }

  const now = new Date();
  try {
    await dbx.transaction(async (tx) => {
      await tx
        .update(orderLineItems)
        .set({ isCancelled: cancelled, updatedAt: now })
        .where(
          line_id
            ? eq(orderLineItems.id, line_id)
            : eq(orderLineItems.orderId, id),
        );
      // Bump the order so the incremental embroidery export re-emits it.
      await tx
        .update(customerOrders)
        .set({ updatedAt: now })
        .where(eq(customerOrders.id, id));
    });
  } catch (e) {
    console.error("PATCH /api/orders/[id]/cancel failed:", e);
    return jsonError("Failed to update cancellation", 500);
  }

  // Authoritative post-update counts for the client.
  const lines = await db
    .select({ isCancelled: orderLineItems.isCancelled })
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, id));
  const total = lines.length;
  const cancelledLines = lines.filter((l) => l.isCancelled).length;

  return jsonData({
    id,
    line_id: line_id ?? null,
    cancelled,
    total_line_count: total,
    cancelled_line_count: cancelledLines,
    is_order_cancelled: isOrderCancelled(total, cancelledLines),
  });
}
