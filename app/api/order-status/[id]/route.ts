import { asc, eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { computeStages } from "@/lib/order-status";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

// GET /api/order-status/:lineId — detail for one design line (read-only).
export async function GET(_req: Request, { params }: Params) {
  const guard = await requireCapability("orders.view");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const [line] = await db
    .select({
      lineId: orderLineItems.id,
      orderId: customerOrders.id,
      orderNo: customerOrders.orderNo,
      odDate: customerOrders.orderDate,
      party: customerOrders.partyName,
      salesPerson: customerOrders.salesPerson,
      agent: customerOrders.agent,
      haste: customerOrders.haste,
      challanNo: customerOrders.challanNo,
      lotNo: customerOrders.lotNo,
      department: customerOrders.department,
      remarks: customerOrders.remarks,
      fabric: orderLineItems.quality,
      design: orderLineItems.designNo,
      qtyMtr: orderLineItems.qtyMtr,
      isCancelled: orderLineItems.isCancelled,
    })
    .from(orderLineItems)
    .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
    .where(eq(orderLineItems.id, id))
    .limit(1);
  if (!line) return jsonError("Line not found", 404);

  const stages = await db
    .select({
      key: workflowStages.stageKey,
      label: workflowStages.label,
    })
    .from(workflowStages)
    .orderBy(asc(workflowStages.sortOrder));

  const rawStages = await db
    .select({
      stageKey: lineStageProgress.stageKey,
      isDone: lineStageProgress.isDone,
      plannedAt: lineStageProgress.plannedAt,
      actualAt: lineStageProgress.actualAt,
      delayMinutes: lineStageProgress.delayMinutes,
    })
    .from(lineStageProgress)
    .where(eq(lineStageProgress.orderLineItemId, id));

  const c = computeStages(
    rawStages,
    stages.map((s) => ({ key: s.key, label: s.label })),
    Date.now(),
  );

  return jsonData({
    lineId: line.lineId,
    order: {
      id: line.orderId,
      orderNo: line.orderNo,
      odDate: line.odDate,
      party: line.party,
      salesPerson: line.salesPerson,
      agent: line.agent,
      haste: line.haste,
      challanNo: line.challanNo,
      lotNo: line.lotNo,
      department: line.department,
      remarks: line.remarks,
    },
    line: {
      fabric: line.fabric,
      design: line.design,
      qtyMtr: line.qtyMtr,
      isCancelled: line.isCancelled,
    },
    stages: c.detailStages,
    doneCount: c.doneCount,
    currentStageKey: c.currentStageKey,
    overall: c.overall,
  });
}
