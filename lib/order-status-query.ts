// The Order status board's query, kept out of the route handler so it can be
// exercised directly (and so the route stays a thin auth + JSON wrapper).
//
// One row per ORDER, aggregated from its design lines; each line keeps its full
// per-stage detail under `lines`, for the expanded row and the CSV export.
// `overall`, `stage` and `cancelled` refine at ORDER level, matching what the
// board shows — they used to be applied per LINE, which is why the board
// ignored them and refined a 5 MB response in the browser instead.
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  aggregateOrderGroups,
  computeStages,
  type OrderStatusGroup,
  type OrderStatusList,
  type OrderStatusRow,
  type OverallStatus,
} from "@/lib/order-status";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

// Orders per page — the board is grouped by order, and paginated here.
export const PAGE_SIZE = 20;
const MAX_LINES = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadOrderStatus(
  p: URLSearchParams,
): Promise<OrderStatusList> {
  const search = p.get("search")?.trim() ?? "";
  const department = p.get("department");
  const salesPerson = p.get("sales_person");
  const party = p.get("party");
  const fabric = p.get("fabric");
  const overall = p.get("overall") as OverallStatus | null;
  const stage = p.get("stage");
  // "Cancelled" isn't an OverallStatus — a cancelled order's derived overall is
  // a vacuous "completed", so it gets its own flag and wins over `overall`.
  const cancelledOnly = p.get("cancelled") === "1";
  const from = p.get("from");
  const to = p.get("to");
  const orderNo = p.get("order_no")?.trim();
  const challanNo = p.get("challan_no")?.trim();
  const lotNo = p.get("lot_no")?.trim();
  const haste = p.get("haste")?.trim();
  const sort = p.get("sort") ?? "od_date";
  const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1);

  // Cancelled lines are INCLUDED here (shown struck on the board); they're
  // excluded from the aggregation + summary in JS further down. Soft-DELETED
  // lines are excluded entirely (they live in Trash); an order with only deleted
  // lines therefore produces no rows and drops off the board.
  const conds: SQL[] = [eq(orderLineItems.isDeleted, false)];
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
      isCancelled: orderLineItems.isCancelled,
    })
    .from(orderLineItems)
    .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
    .where(and(...conds))
    // Newest orders first; within an order, the user's entry order — fabric
    // block created_at, then design no (A1 before A2 in a same-batch block),
    // then a stable id fallback (UUIDs are random, so never order by id alone).
    .orderBy(
      desc(customerOrders.orderDate),
      asc(orderLineItems.createdAt),
      asc(orderLineItems.designNo),
      asc(orderLineItems.id),
    )
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
          stockStatus: lineStageProgress.stockStatus,
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
      createdAt: new Date(l.createdAt).toISOString(),
      isCancelled: l.isCancelled,
      stages: c.cells,
      doneCount: c.doneCount,
      currentStageKey: c.currentStageKey,
      overall: c.overall,
    };
  });

  // Ties (e.g. two lines of the same order) keep the user's entry order:
  // block created_at, then design no (numeric-aware so A2 < A10), then id.
  const tie = (a: OrderStatusRow, b: OrderStatusRow) =>
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    a.design.localeCompare(b.design, undefined, { numeric: true }) ||
    a.lineId.localeCompare(b.lineId);
  allRows.sort((a, b) => {
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

  // Roll the lines up into one row per order — the same function the board used
  // to call on the client, so the aggregation is identical by construction.
  const groups = aggregateOrderGroups(allRows);

  // Order-level summary, over every group (before the refinement below).
  // A fully-cancelled order's derived overall is a vacuous "completed", so the
  // in-progress / completed / overdue tallies count ACTIVE groups only; the
  // Cancelled card counts cancelled DESIGNS, so a partly-cancelled order shows.
  const activeGroups = groups.filter((g) => !g.isCancelled);
  const summary = {
    total: groups.length,
    inProgress: activeGroups.filter((g) => g.overall === "in_progress").length,
    completed: activeGroups.filter((g) => g.overall === "completed").length,
    overdue: activeGroups.filter((g) => g.overall === "overdue").length,
    cancelled: allRows.filter((r) => r.isCancelled).length,
  };

  // Refinement from the KPI cards / "At stage" filter.
  let visible: OrderStatusGroup[] = groups;
  if (cancelledOnly) visible = visible.filter((g) => g.cancelledCount > 0);
  else if (overall === "in_progress" || overall === "completed" || overall === "overdue")
    visible = visible.filter((g) => !g.isCancelled && g.overall === overall);
  if (stage) visible = visible.filter((g) => g.currentStageKey === stage);

  visible.sort(
    (a, b) =>
      (a.odDate < b.odDate ? 1 : a.odDate > b.odDate ? -1 : 0) ||
      a.orderNo.localeCompare(b.orderNo),
  );

  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // ?all=1 → every group, for the CSV export of the current view.
  const exportAll = p.get("all") === "1";
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const rows = exportAll ? visible : visible.slice(start, start + PAGE_SIZE);

  return {
    groups: rows,
    page: safePage,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
    summary,
  };
}
