import { asc, eq, inArray } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import {
  STAGE_KEYS,
  STAGE_LABELS,
  computeLineStatus,
  computeOrderStatus,
} from "@/lib/workflow";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
} from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

const STAGE_ORDER = new Map<string, number>(STAGE_KEYS.map((k, i) => [k, i]));

// GET /api/orders/:id/tracking — order header + each line with its 7 ordered
// stages and derived operations status (per line and rolled up). All roles read.
export async function GET(_req: Request, { params }: Params) {
  const guard = await requireCapability("operations.view");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const [order] = await db
    .select()
    .from(customerOrders)
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!order) return jsonError("Order not found", 404);

  const lines = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, id))
    .orderBy(asc(orderLineItems.createdAt));

  const lineIds = lines.map((l) => l.id);
  const stages = lineIds.length
    ? await db
        .select()
        .from(lineStageProgress)
        .where(inArray(lineStageProgress.orderLineItemId, lineIds))
    : [];

  const stagesByLine = new Map<string, typeof stages>();
  for (const s of stages) {
    const arr = stagesByLine.get(s.orderLineItemId) ?? [];
    arr.push(s);
    stagesByLine.set(s.orderLineItemId, arr);
  }

  const lineOut = lines.map((l) => {
    const rows = (stagesByLine.get(l.id) ?? []).sort(
      (a, b) =>
        (STAGE_ORDER.get(a.stageKey) ?? 0) - (STAGE_ORDER.get(b.stageKey) ?? 0),
    );
    return {
      id: l.id,
      quality: l.quality,
      design_no: l.designNo,
      qty_mtr: l.qtyMtr,
      rate: l.rate,
      line_total: l.lineTotal,
      is_cancelled: l.isCancelled,
      operations_status: computeLineStatus(
        rows.map((s) => ({ stageKey: s.stageKey, isDone: s.isDone })),
      ),
      stages: rows.map((s) => ({
        stage_key: s.stageKey,
        label: STAGE_LABELS[s.stageKey as keyof typeof STAGE_LABELS] ?? s.stageKey,
        planned_at: s.plannedAt,
        actual_at: s.actualAt,
        is_done: s.isDone,
        delay_minutes: s.delayMinutes,
        updated_at: s.updatedAt,
        stock_status: s.stockStatus ?? null,
      })),
    };
  });

  const active = lineOut.filter((l) => !l.is_cancelled);

  return jsonData({
    order: {
      id: order.id,
      order_no: order.orderNo,
      order_date: order.orderDate,
      party_name: order.partyName,
      sales_person: order.salesPerson,
      agent: order.agent,
      haste: order.haste,
      department: order.department,
      challan_no: order.challanNo,
      lot_no: order.lotNo,
    },
    stage_keys: STAGE_KEYS,
    lines: lineOut,
    operations_status: computeOrderStatus(
      active.map((l) => l.operations_status),
    ),
  });
}
