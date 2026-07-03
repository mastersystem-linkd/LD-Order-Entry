import { and, asc, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";

import { jsonData, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import {
  computeStages,
  type OrderStatusRow,
  type OverallStatus,
} from "@/lib/order-status";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

const PAGE_SIZE = 25;
const MAX_LINES = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/order-status — one row per (non-cancelled) design line with derived
// per-stage status, progress, and overall. Filters + summary + pagination.
export async function GET(req: Request) {
  const guard = await requireCapability("orders.view");
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const p = url.searchParams;
  const search = p.get("search")?.trim() ?? "";
  const department = p.get("department");
  const salesPerson = p.get("sales_person");
  const party = p.get("party");
  const fabric = p.get("fabric");
  const overall = p.get("overall") as OverallStatus | null;
  const stage = p.get("stage");
  const from = p.get("from");
  const to = p.get("to");
  const orderNo = p.get("order_no")?.trim();
  const challanNo = p.get("challan_no")?.trim();
  const lotNo = p.get("lot_no")?.trim();
  const haste = p.get("haste")?.trim();
  const sort = p.get("sort") ?? "od_date";
  const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1);

  const conds = [eq(orderLineItems.isCancelled, false)];
  if (search) {
    conds.push(
      or(
        ilike(customerOrders.orderNo, `%${search}%`),
        ilike(customerOrders.partyName, `%${search}%`),
        ilike(orderLineItems.quality, `%${search}%`),
        ilike(orderLineItems.designNo, `%${search}%`),
        ilike(customerOrders.salesPerson, `%${search}%`),
      )!,
    );
  }
  if (department === "LD" || department === "LINKD")
    conds.push(eq(customerOrders.department, department));
  if (salesPerson) conds.push(eq(customerOrders.salesPerson, salesPerson));
  if (party) conds.push(eq(customerOrders.partyName, party));
  if (fabric) conds.push(eq(orderLineItems.quality, fabric));
  if (orderNo) conds.push(ilike(customerOrders.orderNo, `%${orderNo}%`));
  if (challanNo) conds.push(ilike(customerOrders.challanNo, `%${challanNo}%`));
  if (lotNo) conds.push(ilike(customerOrders.lotNo, `%${lotNo}%`));
  if (haste) conds.push(ilike(customerOrders.haste, `%${haste}%`));
  if (from && ISO_DATE.test(from)) conds.push(gte(customerOrders.orderDate, from));
  if (to && ISO_DATE.test(to)) conds.push(lte(customerOrders.orderDate, to));

  const stages = await db
    .select({
      key: workflowStages.stageKey,
      label: workflowStages.label,
      sort: workflowStages.sortOrder,
    })
    .from(workflowStages)
    .orderBy(asc(workflowStages.sortOrder));
  const ordered = stages.map((s) => ({ key: s.key, label: s.label }));

  const lines = await db
    .select({
      lineId: orderLineItems.id,
      orderId: orderLineItems.orderId,
      orderNo: customerOrders.orderNo,
      party: customerOrders.partyName,
      fabric: orderLineItems.quality,
      design: orderLineItems.designNo,
      qtyMtr: orderLineItems.qtyMtr,
      lineTotal: orderLineItems.lineTotal,
      salesPerson: customerOrders.salesPerson,
      odDate: customerOrders.orderDate,
      haste: customerOrders.haste,
      challanNo: customerOrders.challanNo,
      lotNo: customerOrders.lotNo,
      createdAt: orderLineItems.createdAt,
    })
    .from(orderLineItems)
    .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
    .where(and(...conds))
    // Deterministic window so the cap (and JS sort/paginate over it) is stable.
    .orderBy(desc(customerOrders.orderDate), asc(orderLineItems.id))
    .limit(MAX_LINES);

  const lineIds = lines.map((l) => l.lineId);
  const stageRows = lineIds.length
    ? await db
        .select({
          lineId: lineStageProgress.orderLineItemId,
          stageKey: lineStageProgress.stageKey,
          isDone: lineStageProgress.isDone,
          plannedAt: lineStageProgress.plannedAt,
          actualAt: lineStageProgress.actualAt,
          delayMinutes: lineStageProgress.delayMinutes,
        })
        .from(lineStageProgress)
        .where(inArray(lineStageProgress.orderLineItemId, lineIds))
    : [];

  const stagesByLine = new Map<string, typeof stageRows>();
  for (const s of stageRows) {
    const arr = stagesByLine.get(s.lineId) ?? [];
    arr.push(s);
    stagesByLine.set(s.lineId, arr);
  }

  const now = Date.now();
  const allRows: OrderStatusRow[] = lines.map((l) => {
    const c = computeStages(stagesByLine.get(l.lineId) ?? [], ordered, now);
    return {
      lineId: l.lineId,
      orderId: l.orderId,
      orderNo: l.orderNo,
      party: l.party,
      fabric: l.fabric,
      design: l.design,
      qtyMtr: l.qtyMtr,
      lineTotal: l.lineTotal,
      salesPerson: l.salesPerson,
      odDate: l.odDate,
      haste: l.haste,
      challanNo: l.challanNo,
      lotNo: l.lotNo,
      stages: c.cells,
      doneCount: c.doneCount,
      currentStageKey: c.currentStageKey,
      overall: c.overall,
    };
  });

  // Summary over the DB-filtered set (before overall/stage refinement).
  const summary = {
    total: allRows.length,
    inProgress: allRows.filter((r) => r.overall === "in_progress").length,
    completed: allRows.filter((r) => r.overall === "completed").length,
    overdue: allRows.filter((r) => r.overall === "overdue").length,
  };

  let filtered = allRows;
  if (overall === "in_progress" || overall === "completed" || overall === "overdue")
    filtered = filtered.filter((r) => r.overall === overall);
  if (stage) filtered = filtered.filter((r) => r.currentStageKey === stage);

  const tie = (a: OrderStatusRow, b: OrderStatusRow) =>
    a.lineId.localeCompare(b.lineId);
  filtered.sort((a, b) => {
    switch (sort) {
      case "order_no":
        return a.orderNo.localeCompare(b.orderNo) || tie(a, b);
      case "party":
        return a.party.localeCompare(b.party) || tie(a, b);
      case "progress":
        return b.doneCount - a.doneCount || tie(a, b);
      case "od_date":
      default:
        return (
          (a.odDate < b.odDate ? 1 : a.odDate > b.odDate ? -1 : 0) || tie(a, b)
        );
    }
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // ?all=1 → the whole filtered set (for CSV export of the current view).
  const exportAll = p.get("all") === "1";
  const start = (page - 1) * PAGE_SIZE;
  const rows = exportAll ? filtered : filtered.slice(start, start + PAGE_SIZE);

  return jsonData({
    rows,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
    summary,
  });
}
