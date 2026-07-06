import { count, desc, eq, sql } from "drizzle-orm";

import { jsonData, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { isOrderDeleted } from "@/lib/workflow";
import { customerOrders, orderLineItems } from "@/db/schema";

type TrashOrder = {
  id: string;
  order_no: string;
  party_name: string;
  order_date: string;
  design_count: number;
  qty_total: number;
  grand_total: number;
  deleted_at: Date | string;
};

type TrashDesign = {
  line_id: string;
  order_id: string;
  order_no: string;
  party_name: string;
  order_date: string;
  quality: string;
  design_no: string;
  qty_mtr: number;
  line_total: number | null;
  deleted_at: Date | string;
};

// GET /api/trash — soft-deleted items for the Trash page (orders.edit only):
//  - orders:  fully-deleted orders (every line deleted) → restore-all / purge
//  - designs: individually-deleted designs in otherwise-active orders → restore
export async function GET() {
  const guard = await requireCapability("orders.edit");
  if (!guard.ok) return guard.response;

  // Per-order line counts to classify fully- vs partially-deleted orders.
  const counts = await db
    .select({
      orderId: orderLineItems.orderId,
      total: count(),
      deleted: sql<number>`count(*) filter (where ${orderLineItems.isDeleted})`,
    })
    .from(orderLineItems)
    .groupBy(orderLineItems.orderId);

  const fullyDeleted = new Set<string>();
  let anyDeleted = false;
  for (const c of counts) {
    const d = Number(c.deleted);
    if (d > 0) anyDeleted = true;
    if (isOrderDeleted(Number(c.total), d)) fullyDeleted.add(c.orderId);
  }

  if (!anyDeleted) {
    return jsonData({
      orders: [],
      designs: [],
      summary: { deleted_orders: 0, deleted_designs: 0 },
    });
  }

  // Every deleted line + its order header. Newest deletions first.
  const rows = await db
    .select({
      lineId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      quality: orderLineItems.quality,
      designNo: orderLineItems.designNo,
      qtyMtr: orderLineItems.qtyMtr,
      lineTotal: orderLineItems.lineTotal,
      isCancelled: orderLineItems.isCancelled,
      updatedAt: orderLineItems.updatedAt,
      orderNo: customerOrders.orderNo,
      party: customerOrders.partyName,
      orderDate: customerOrders.orderDate,
    })
    .from(orderLineItems)
    .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
    .where(eq(orderLineItems.isDeleted, true))
    .orderBy(desc(orderLineItems.updatedAt));

  const orderMap = new Map<string, TrashOrder>();
  const designs: TrashDesign[] = [];
  for (const r of rows) {
    if (fullyDeleted.has(r.orderId)) {
      // One aggregated card per fully-deleted order. Rows are newest-first, so
      // the first line seen for an order carries the latest deleted_at.
      let o = orderMap.get(r.orderId);
      if (!o) {
        o = {
          id: r.orderId,
          order_no: r.orderNo,
          party_name: r.party,
          order_date: r.orderDate,
          design_count: 0,
          qty_total: 0,
          grand_total: 0,
          deleted_at: r.updatedAt,
        };
        orderMap.set(r.orderId, o);
      }
      // design_count = all deleted designs (what Restore brings back), but qty /
      // amount exclude cancelled lines to match the app-wide totals convention.
      o.design_count += 1;
      if (!r.isCancelled) {
        o.qty_total += Number(r.qtyMtr);
        o.grand_total += Number(r.lineTotal ?? 0);
      }
    } else {
      designs.push({
        line_id: r.lineId,
        order_id: r.orderId,
        order_no: r.orderNo,
        party_name: r.party,
        order_date: r.orderDate,
        quality: r.quality,
        design_no: r.designNo,
        qty_mtr: Number(r.qtyMtr),
        line_total: r.lineTotal == null ? null : Number(r.lineTotal),
        deleted_at: r.updatedAt,
      });
    }
  }

  const orders = [...orderMap.values()].map((o) => ({
    ...o,
    qty_total: Number(o.qty_total.toFixed(2)),
    grand_total: Number(o.grand_total.toFixed(2)),
  }));

  return jsonData({
    orders,
    designs,
    summary: { deleted_orders: orders.length, deleted_designs: designs.length },
  });
}
