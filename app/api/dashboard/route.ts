import { and, asc, count, desc, eq, exists, gte, lt, lte, sql } from "drizzle-orm";

import { jsonData, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { dayCount } from "@/lib/dashboard";
import {
  computeOrderStatus,
  isOrderCancelled,
  isOrderDeleted,
  type OperationsStatus,
} from "@/lib/workflow";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(value: string | null, fallback: string): string {
  const v = (value ?? "").slice(0, 10);
  return ISO_DATE.test(v) ? v : fallback;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// GET /api/dashboard?from=&to=&department= — server-aggregated analytics.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = dateStr(url.searchParams.get("from"), shiftDays(today, -29));
  const to = dateStr(url.searchParams.get("to"), today);
  const deptParam = url.searchParams.get("department");
  const department =
    deptParam === "LD" || deptParam === "LINKD" ? deptParam : "ALL";
  const now = new Date();

  const deptCond =
    department === "ALL"
      ? undefined
      : eq(customerOrders.department, department);
  const rangeWhere = (f: string, t: string) =>
    and(gte(customerOrders.orderDate, f), lte(customerOrders.orderDate, t), deptCond);
  const orderWhere = rangeWhere(from, to);

  // Soft-delete filters (analytics must ignore trashed data, mirroring
  // /api/orders): line aggregates exclude deleted lines; order counts require an
  // order to still have at least one non-deleted line (fully-trashed → hidden).
  const notDeletedLine = eq(orderLineItems.isDeleted, false);
  const hasVisibleLine = exists(
    db
      .select({ one: sql`1` })
      .from(orderLineItems)
      .where(
        and(
          eq(orderLineItems.orderId, customerOrders.id),
          eq(orderLineItems.isDeleted, false),
        ),
      ),
  );

  // Headline totals for any window (reused for the prior period). Its two
  // aggregates are independent, so fire them together.
  async function totals(f: string, t: string) {
    const w = rangeWhere(f, t);
    const [ocRes, aggRes] = await Promise.all([
      db.select({ n: count() }).from(customerOrders).where(and(w, hasVisibleLine)),
      db
        .select({
          value: sql<string>`coalesce(sum(${orderLineItems.lineTotal}), 0)`,
          meters: sql<string>`coalesce(sum(${orderLineItems.qtyMtr}), 0)`,
        })
        .from(orderLineItems)
        .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
        .where(and(w, eq(orderLineItems.isCancelled, false), notDeletedLine)),
    ]);
    return {
      orders: Number(ocRes[0].n),
      value: Number(aggRes[0].value),
      meters: Number(aggRes[0].meters),
    };
  }

  const len = dayCount(from, to);
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(prevTo, -(len - 1));

  // Every query below reads independently from the range/department filters —
  // none depends on another query's *result* (all cross-query work is the pure
  // JS below, run after the data lands). On Neon's HTTP driver each query is its
  // own network round trip, so we fire them all at once rather than awaiting 13
  // in series — the endpoint answers them concurrently.
  const [
    stages,
    lineRows,
    otRes,
    ordersByDay,
    valueByDay,
    topPartiesRaw,
    topFabricsRaw,
    overdueRows,
    current,
    prev,
    cancelAgg,
    trashAgg,
  ] = await Promise.all([
    // Ordered stages (labels + sort) for the pipeline + status roll-up.
    db
      .select({
        key: workflowStages.stageKey,
        label: workflowStages.label,
        sort: workflowStages.sortOrder,
      })
      .from(workflowStages)
      .orderBy(asc(workflowStages.sortOrder)),

    // Per-line progress: done-stage count + current (lowest undone) stage.
    db
      .select({
        orderId: orderLineItems.orderId,
        orderNo: customerOrders.orderNo,
        party: customerOrders.partyName,
        orderDate: customerOrders.orderDate,
        lineTotal: orderLineItems.lineTotal,
        doneCount: sql<number>`count(*) filter (where ${lineStageProgress.isDone})`,
        currentSort: sql<
          number | null
        >`min(${workflowStages.sortOrder}) filter (where ${lineStageProgress.isDone} = false)`,
      })
      .from(orderLineItems)
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .innerJoin(
        lineStageProgress,
        eq(lineStageProgress.orderLineItemId, orderLineItems.id),
      )
      .innerJoin(
        workflowStages,
        eq(workflowStages.stageKey, lineStageProgress.stageKey),
      )
      .where(and(orderWhere, eq(orderLineItems.isCancelled, false), notDeletedLine))
      .groupBy(orderLineItems.id, customerOrders.id),

    // On-time rate over completed stages.
    db
      .select({
        done: sql<number>`count(*)`,
        onTime: sql<number>`count(*) filter (where coalesce(${lineStageProgress.delayMinutes}, 0) <= 0)`,
      })
      .from(lineStageProgress)
      .innerJoin(
        orderLineItems,
        eq(orderLineItems.id, lineStageProgress.orderLineItemId),
      )
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(
        and(
          orderWhere,
          eq(orderLineItems.isCancelled, false),
          notDeletedLine,
          eq(lineStageProgress.isDone, true),
        ),
      ),

    // Trend: order count per day.
    db
      .select({ d: customerOrders.orderDate, n: count() })
      .from(customerOrders)
      .where(and(orderWhere, hasVisibleLine))
      .groupBy(customerOrders.orderDate),

    // Trend: order value per day.
    db
      .select({
        d: customerOrders.orderDate,
        v: sql<string>`coalesce(sum(${orderLineItems.lineTotal}), 0)`,
      })
      .from(orderLineItems)
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(and(orderWhere, eq(orderLineItems.isCancelled, false), notDeletedLine))
      .groupBy(customerOrders.orderDate),

    // Top parties by value.
    db
      .select({
        party: customerOrders.partyName,
        orders: sql<number>`count(distinct ${customerOrders.id})`,
        value: sql<string>`coalesce(sum(${orderLineItems.lineTotal}), 0)`,
      })
      .from(orderLineItems)
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(and(orderWhere, eq(orderLineItems.isCancelled, false), notDeletedLine))
      .groupBy(customerOrders.partyName)
      .orderBy(desc(sql`coalesce(sum(${orderLineItems.lineTotal}), 0)`))
      .limit(6),

    // Top fabrics by meters.
    db
      .select({
        fabric: orderLineItems.quality,
        meters: sql<string>`coalesce(sum(${orderLineItems.qtyMtr}), 0)`,
      })
      .from(orderLineItems)
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(and(orderWhere, eq(orderLineItems.isCancelled, false), notDeletedLine))
      .groupBy(orderLineItems.quality)
      .orderBy(desc(sql`coalesce(sum(${orderLineItems.qtyMtr}), 0)`))
      .limit(6),

    // Attention: every overdue (undone, past-planned) stage; reduced in JS to
    // the most-overdue one per order.
    db
      .select({
        orderId: customerOrders.id,
        orderNo: customerOrders.orderNo,
        party: customerOrders.partyName,
        label: workflowStages.label,
        plannedAt: lineStageProgress.plannedAt,
      })
      .from(lineStageProgress)
      .innerJoin(
        orderLineItems,
        eq(orderLineItems.id, lineStageProgress.orderLineItemId),
      )
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .innerJoin(
        workflowStages,
        eq(workflowStages.stageKey, lineStageProgress.stageKey),
      )
      .where(
        and(
          orderWhere,
          eq(orderLineItems.isCancelled, false),
          notDeletedLine,
          eq(lineStageProgress.isDone, false),
          lt(lineStageProgress.plannedAt, now),
        ),
      ),

    // KPI totals for the current and prior windows.
    totals(from, to),
    totals(prevFrom, prevTo),

    // Cancellation aggregate (in range): per-order non-deleted line counts +
    // how many are cancelled — drives the cancelled designs / orders metrics.
    db
      .select({
        orderId: orderLineItems.orderId,
        total: count(),
        cancelled: sql<number>`count(*) filter (where ${orderLineItems.isCancelled})`,
      })
      .from(orderLineItems)
      .innerJoin(customerOrders, eq(customerOrders.id, orderLineItems.orderId))
      .where(and(orderWhere, notDeletedLine))
      .groupBy(orderLineItems.orderId),

    // Trash aggregate (GLOBAL — Trash is not range-bound): per-order line counts
    // + how many are soft-deleted, to split fully-deleted orders from designs.
    db
      .select({
        orderId: orderLineItems.orderId,
        total: count(),
        deleted: sql<number>`count(*) filter (where ${orderLineItems.isDeleted})`,
      })
      .from(orderLineItems)
      .groupBy(orderLineItems.orderId),
  ]);

  // Cancellation roll-up (in range).
  let cancelledDesigns = 0;
  let ordersWithCancel = 0;
  let cancelledOrders = 0;
  for (const r of cancelAgg) {
    const c = Number(r.cancelled);
    const t = Number(r.total);
    cancelledDesigns += c;
    if (c > 0) ordersWithCancel += 1;
    if (isOrderCancelled(t, c)) cancelledOrders += 1;
  }

  // Trash roll-up (global): fully-deleted orders vs individually-deleted designs
  // (matches the Trash page's two lists).
  let trashOrders = 0;
  let trashDesigns = 0;
  for (const r of trashAgg) {
    const dl = Number(r.deleted);
    const t = Number(r.total);
    if (dl === 0) continue;
    if (isOrderDeleted(t, dl)) trashOrders += 1;
    else trashDesigns += dl;
  }

  const stageCount = stages.length || 7;
  // Same predicate as overdueRows (the workflow_stages join is 1:1 via PK, so
  // it can't change the count) — derive the count instead of a second scan.
  const overdueStages = overdueRows.length;
  const doneStages = Number(otRes[0].done);
  const onTimeStages = Number(otRes[0].onTime);
  const onTimePct =
    doneStages === 0 ? 100 : Math.round((onTimeStages / doneStages) * 100);

  const lineStatus = (done: number): OperationsStatus =>
    done >= stageCount
      ? "COMPLETED"
      : done > 0
        ? "PARTIALLY COMPLETED"
        : "PENDING";

  // Pipeline: not-yet-completed lines grouped by their current stage.
  const pipelineCount = new Map<number, number>();
  for (const r of lineRows) {
    const cs = r.currentSort == null ? null : Number(r.currentSort);
    if (cs != null) pipelineCount.set(cs, (pipelineCount.get(cs) ?? 0) + 1);
  }
  const pipeline = stages.map((s) => ({
    stageKey: s.key,
    label: s.label,
    sortOrder: s.sort,
    count: pipelineCount.get(s.sort) ?? 0,
  }));

  // Roll lines up to order status + value.
  type OrderAgg = {
    orderNo: string;
    party: string;
    orderDate: string;
    value: number;
    statuses: OperationsStatus[];
  };
  const byOrder = new Map<string, OrderAgg>();
  for (const r of lineRows) {
    let o = byOrder.get(r.orderId);
    if (!o) {
      o = {
        orderNo: r.orderNo,
        party: r.party,
        orderDate: r.orderDate,
        value: 0,
        statuses: [],
      };
      byOrder.set(r.orderId, o);
    }
    o.value += Number(r.lineTotal ?? 0);
    o.statuses.push(lineStatus(Number(r.doneCount)));
  }
  const orders = [...byOrder.entries()].map(([id, o]) => ({
    id,
    orderNo: o.orderNo,
    party: o.party,
    orderDate: o.orderDate,
    value: o.value,
    status: computeOrderStatus(o.statuses),
  }));

  const completedOrders = orders.filter((o) => o.status === "COMPLETED").length;
  const activeOrders = orders.length - completedOrders;
  const statusBreakdown = {
    completed: completedOrders,
    partially: orders.filter((o) => o.status === "PARTIALLY COMPLETED").length,
    pending: orders.filter((o) => o.status === "PENDING").length,
    cancelled: cancelledOrders,
  };
  const recentOrders = [...orders]
    .sort((a, b) => (a.orderDate < b.orderDate ? 1 : a.orderDate > b.orderDate ? -1 : 0))
    .slice(0, 8);

  // Trend (one point per day, zero-filled).
  const oMap = new Map(ordersByDay.map((r) => [r.d, Number(r.n)]));
  const vMap = new Map(valueByDay.map((r) => [r.d, Number(r.v)]));
  const trend: { date: string; orders: number; value: number }[] = [];
  {
    let d = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    let guardN = 0;
    while (d <= end && guardN < 400) {
      const k = d.toISOString().slice(0, 10);
      trend.push({ date: k, orders: oMap.get(k) ?? 0, value: vMap.get(k) ?? 0 });
      d = new Date(d);
      d.setUTCDate(d.getUTCDate() + 1);
      guardN += 1;
    }
  }

  const topParties = topPartiesRaw.map((r) => ({
    party: r.party,
    orders: Number(r.orders),
    value: Number(r.value),
  }));
  const topFabrics = topFabricsRaw.map((r) => ({
    fabric: r.fabric,
    meters: Number(r.meters),
  }));

  // Attention: per order, its most-overdue (earliest planned) undone stage.
  const attnMap = new Map<
    string,
    { orderNo: string; party: string; plannedAt: Date; label: string }
  >();
  for (const r of overdueRows) {
    if (!r.plannedAt) continue;
    const pa = new Date(r.plannedAt as unknown as string);
    const cur = attnMap.get(r.orderId);
    if (!cur || pa < cur.plannedAt) {
      attnMap.set(r.orderId, {
        orderNo: r.orderNo,
        party: r.party,
        plannedAt: pa,
        label: r.label,
      });
    }
  }
  const attention = [...attnMap.entries()]
    .map(([orderId, a]) => ({
      orderId,
      orderNo: a.orderNo,
      party: a.party,
      stageLabel: a.label,
      daysOverdue: Math.floor(
        (now.getTime() - a.plannedAt.getTime()) / 86_400_000,
      ),
    }))
    .sort((x, y) => y.daysOverdue - x.daysOverdue)
    .slice(0, 10);

  return jsonData({
    range: { from, to, department },
    kpis: {
      orders: current.orders,
      value: current.value,
      meters: current.meters,
      activeOrders,
      completedOrders,
      overdueStages,
      onTimePct,
      prev,
    },
    pipeline,
    statusBreakdown,
    delays: { onTime: onTimeStages, late: doneStages - onTimeStages },
    cancellation: { cancelledDesigns, ordersWithCancel, cancelledOrders },
    trash: { deletedDesigns: trashDesigns, deletedOrders: trashOrders },
    trend,
    topParties,
    topFabrics,
    recentOrders,
    attention,
  });
}
