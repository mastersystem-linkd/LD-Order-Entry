import { and, eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { orderLineItems } from "@/db/schema";

type Params = { params: Promise<{ id: string; lineId: string }> };

// DELETE /api/orders/:id/lines/:lineId — permanently remove ONE design line
// (cascade drops its stage progress). Used from Trash to purge a soft-deleted
// design for good. Only a line that is already soft-deleted can be purged here
// (guards against wiping an active design). orders.edit only.
export async function DELETE(_req: Request, { params }: Params) {
  const guard = await requireCapability("orders.edit");
  if (!guard.ok) return guard.response;
  const { id, lineId } = await params;

  const [line] = await db
    .select({ id: orderLineItems.id })
    .from(orderLineItems)
    .where(
      and(
        eq(orderLineItems.id, lineId),
        eq(orderLineItems.orderId, id),
        eq(orderLineItems.isDeleted, true),
      ),
    )
    .limit(1);
  if (!line) return jsonError("Deleted design not found on this order", 404);

  // Re-assert the guards in the DELETE itself so a concurrent restore between the
  // SELECT and here can't let us hard-delete a line that became active (TOCTOU).
  await db
    .delete(orderLineItems)
    .where(
      and(
        eq(orderLineItems.id, lineId),
        eq(orderLineItems.orderId, id),
        eq(orderLineItems.isDeleted, true),
      ),
    );
  return jsonData({ id, line_id: lineId });
}
