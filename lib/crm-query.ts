// The CRM follow-up queue's query, kept out of the route handler so the route
// stays a thin auth + JSON wrapper (same shape as lib/order-status-query.ts).
//
// ⚠️ Concurrency: lib/db.ts caps postgres.js at max:5 for the WHOLE process, and
// through the Supavisor pooler the surplus does not queue — it stalls. Every
// function here runs its queries SEQUENTIALLY or in waves of ≤4. The reconcile
// is deliberately two statements, not a fan-out.
import {
  and,
  count,
  eq,
  gte,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  CRM_DEFAULTS,
  followupDueAt,
  followupPriority,
  priorityBand,
  type CrmConfig,
  type FollowupList,
  type FollowupRow,
  type FollowupSort,
  type FollowupStatus,
  type IssueCategory,
  type IssueList,
  type IssueResolution,
  type IssueRow,
  type IssueSeverity,
  type IssueStatus,
  type OwnerDept,
} from "@/lib/crm";

// Re-exported for server callers that already import this module.
export type { FollowupList, FollowupRow, FollowupSort, IssueList, IssueRow };
import {
  crmFollowups,
  crmIssues,
  crmSettings,
  customerOrders,
  lineStageProgress,
  orderLineItems,
  users,
} from "@/db/schema";

export const PAGE_SIZE = 20;
/** Hard ceiling on one reconcile pass, so a first run cannot become a 10k-row insert. */
const RECONCILE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * The single crm_settings row. Falls back to the code defaults when the row is
 * missing so a fresh database renders a working screen instead of a 500.
 */
export async function loadCrmConfig(): Promise<CrmConfig> {
  const rows = await db.select().from(crmSettings).limit(1);
  const r = rows[0];
  if (!r) {
    return { ...CRM_DEFAULTS, transportTransitDays: null };
  }
  return {
    transitDaysDefault: r.transitDaysDefault,
    followupDueDays: r.followupDueDays,
    maxAttempts: r.maxAttempts,
    escalateRatingAt: r.escalateRatingAt,
    autoCreateFollowups: r.autoCreateFollowups,
    transportTransitDays:
      (r.transportTransitDays as Record<string, number> | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reconcile (§12.9) — creation is never manual
// ---------------------------------------------------------------------------

/**
 * Find delivered orders that have no follow-up yet and create one.
 *
 * Two statements, on purpose: a SELECT that decides, then an INSERT that
 * records. Expressing it as one INSERT…SELECT would be marginally faster and
 * considerably harder to read, and the race it would close is already closed by
 * `onConflictDoNothing` on the order_id unique key — two concurrent readers both
 * insert, and the loser is silently dropped.
 *
 * Returns how many rows it created, so the caller can say so.
 */
export async function reconcileFollowups(cfg: CrmConfig): Promise<number> {
  if (!cfg.autoCreateFollowups) return 0;

  // Per active line: is LR ticked, when was dispatch ticked, was every done
  // stage inside its SLA, and was it ever blocked at stock checking.
  const lineState = db.$with("line_state").as(
    db
      .select({
        orderId: orderLineItems.orderId,
        lineId: orderLineItems.id,
        lrDone: sql<boolean>`bool_or(${lineStageProgress.stageKey} = 'received_lr' and ${lineStageProgress.isDone})`.as("lr_done"),
        dispatchAt: sql<string | null>`max(${lineStageProgress.actualAt}) filter (where ${lineStageProgress.stageKey} = 'dispatch' and ${lineStageProgress.isDone})`.as("dispatch_at"),
        // NULL when nothing is done yet — coalesced to true at order level so an
        // untouched line does not read as "late".
        onTime: sql<boolean | null>`bool_and(coalesce(${lineStageProgress.delayMinutes}, 0) <= 0) filter (where ${lineStageProgress.isDone})`.as("on_time"),
        oos: sql<boolean>`bool_or(${lineStageProgress.stockStatus} = 'out_of_stock')`.as("oos"),
      })
      .from(orderLineItems)
      .leftJoin(
        lineStageProgress,
        eq(lineStageProgress.orderLineItemId, orderLineItems.id),
      )
      // Active lines only — the same predicate the rest of the app uses.
      .where(
        and(
          eq(orderLineItems.isDeleted, false),
          eq(orderLineItems.isCancelled, false),
        ),
      )
      .groupBy(orderLineItems.orderId, orderLineItems.id),
  );

  // Transit allowance for this order's transport, falling back to the default.
  const transit = sql<number>`coalesce((${crmSettings.transportTransitDays} ->> ${customerOrders.transport})::int, ${crmSettings.transitDaysDefault})`;
  // A line has landed if the LR is back, or dispatch + transit has elapsed.
  // A dispatch with no actual_at is NOT landed: there is no clock to run.
  const landedAt = sql<string>`case
      when ${lineState.lrDone} then coalesce(${lineState.dispatchAt}, now())
      else ${lineState.dispatchAt} + make_interval(days => ${transit})
    end`;
  const isLanded = sql<boolean>`(${lineState.lrDone} or (${lineState.dispatchAt} is not null and ${lineState.dispatchAt} + make_interval(days => ${transit}) <= now()))`;

  const candidates = await db
    .with(lineState)
    .select({
      orderId: customerOrders.id,
      orderNo: customerOrders.orderNo,
      crrCustomerId: customerOrders.crrCustomerId,
      activeLines: count(),
      allLanded: sql<boolean>`bool_and(${isLanded})`,
      allLr: sql<boolean>`bool_and(${lineState.lrDone})`,
      deliveredAt: sql<string>`max(${landedAt})`,
      systemOnTime: sql<boolean>`bool_and(coalesce(${lineState.onTime}, true))`,
      lineIds: sql<string[]>`jsonb_agg(${lineState.lineId})`,
    })
    .from(lineState)
    .innerJoin(customerOrders, eq(customerOrders.id, lineState.orderId))
    .crossJoin(crmSettings)
    // Nothing already followed up.
    .leftJoin(crmFollowups, eq(crmFollowups.orderId, customerOrders.id))
    .where(isNull(crmFollowups.id))
    .groupBy(
      customerOrders.id,
      customerOrders.orderNo,
      customerOrders.crrCustomerId,
      customerOrders.transport,
      crmSettings.transitDaysDefault,
      crmSettings.transportTransitDays,
    )
    // bool_and over zero rows is NULL, so an order with no active lines is
    // excluded here rather than needing a separate guard.
    .having(sql`bool_and(${isLanded})`)
    .limit(RECONCILE_LIMIT);

  if (candidates.length === 0) return 0;

  const now = new Date();
  const values = candidates.map((c) => {
    const deliveredAt = c.deliveredAt ? new Date(c.deliveredAt) : now;
    return {
      orderId: c.orderId,
      orderNo: c.orderNo,
      crrCustomerId: c.crrCustomerId,
      status: "DUE" as const,
      deliveryBasis: c.allLr ? ("received_lr" as const) : ("dispatch_transit" as const),
      deliveredAt,
      dueAt: followupDueAt(deliveredAt, cfg.followupDueDays),
      // Snapshot, SLA-config-relative — see the warning in CLAUDE.md §12.3.
      systemOnTime: c.systemOnTime,
      deliveredLineIds: c.lineIds ?? [],
      createdBy: "system",
    };
  });

  const inserted = await db
    .insert(crmFollowups)
    .values(values)
    .onConflictDoNothing({ target: crmFollowups.orderId })
    .returning({ id: crmFollowups.id });

  return inserted.length;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * Upper bound on the working set. The queue is delivered-orders-awaiting-a-call,
 * which is inherently small (hundreds, not millions) — but a ceiling means a
 * pathological database can never turn this into an unbounded response.
 */
const MAX_ROWS = 2000;

export async function loadFollowups(p: URLSearchParams): Promise<FollowupList> {
  // Sequential, not Promise.all: three of these are cheap and the pool is the
  // scarce resource, not the round trips (see the ⚠️ note at the top).
  const cfg = await loadCrmConfig();
  const created = await reconcileFollowups(cfg);

  const page = Math.max(1, Number(p.get("page") ?? "1") || 1);
  const sort = (p.get("sort") ?? "priority") as FollowupSort;
  const status = p.get("status");
  const q = p.get("q")?.trim() ?? "";
  const transport = p.get("transport")?.trim() ?? "";
  const assigned = p.get("assigned")?.trim() ?? "";
  const from = p.get("from");
  const to = p.get("to");
  // Which KPI card is active. Applied AFTER the rows are derived, using the
  // very same predicate that produced the card's number — so the count on the
  // card and the rows behind it can never disagree.
  const kpi = p.get("kpi");

  // Per-order roll-ups over the lines. Value and quantity count ACTIVE lines
  // only; the cancellation flag deliberately looks at all non-deleted lines,
  // since "this order had something cancelled" is exactly what the coordinator
  // needs to know before dialling.
  const orderAgg = db.$with("order_agg").as(
    db
      .select({
        orderId: orderLineItems.orderId,
        value: sql<string>`coalesce(sum(${orderLineItems.lineTotal}) filter (where not ${orderLineItems.isCancelled}), 0)`.as("value"),
        qty: sql<string>`coalesce(sum(${orderLineItems.qtyMtr}) filter (where not ${orderLineItems.isCancelled}), 0)`.as("qty"),
        designs: sql<number>`count(*) filter (where not ${orderLineItems.isCancelled})`.as("designs"),
        qualities: sql<number>`count(distinct ${orderLineItems.quality}) filter (where not ${orderLineItems.isCancelled})`.as("qualities"),
        hadCancellation: sql<boolean>`bool_or(${orderLineItems.isCancelled})`.as("had_cancellation"),
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.isDeleted, false))
      .groupBy(orderLineItems.orderId),
  );

  // Was any line ever blocked at stock checking? A separate CTE because it
  // needs line_stage_progress, and joining that into orderAgg would multiply
  // the rows the sums run over.
  const oosAgg = db.$with("oos_agg").as(
    db
      .select({
        orderId: orderLineItems.orderId,
        oos: sql<boolean>`bool_or(${lineStageProgress.stockStatus} = 'out_of_stock')`.as("oos"),
      })
      .from(orderLineItems)
      .innerJoin(
        lineStageProgress,
        eq(lineStageProgress.orderLineItemId, orderLineItems.id),
      )
      .where(eq(orderLineItems.isDeleted, false))
      .groupBy(orderLineItems.orderId),
  );

  // Open complaints per follow-up, for the badge in the queue.
  const issueAgg = db.$with("issue_agg").as(
    db
      .select({
        followupId: crmIssues.followupId,
        open: sql<number>`count(*) filter (where ${crmIssues.status} in ('OPEN','IN_PROGRESS'))`.as("open"),
        high: sql<boolean>`bool_or(${crmIssues.severity} = 'HIGH')`.as("high"),
      })
      .from(crmIssues)
      .groupBy(crmIssues.followupId),
  );

  const where: SQL[] = [];
  if (status && status !== "ALL") where.push(eq(crmFollowups.status, status));
  if (transport) where.push(eq(customerOrders.transport, transport));
  if (assigned) where.push(eq(crmFollowups.assignedTo, assigned));
  if (from) where.push(gte(crmFollowups.deliveredAt, new Date(from)));
  // `to` is a plain date; take the whole of that day.
  if (to) where.push(lte(crmFollowups.deliveredAt, new Date(to + "T23:59:59.999Z")));
  if (q) {
    const like = `%${q}%`;
    const m = or(
      sql`${crmFollowups.orderNo} ilike ${like}`,
      sql`${customerOrders.partyName} ilike ${like}`,
    );
    if (m) where.push(m);
  }

  const raw = await db
    .with(orderAgg, oosAgg, issueAgg)
    .select({
      id: crmFollowups.id,
      orderId: crmFollowups.orderId,
      orderNo: crmFollowups.orderNo,
      orderDate: customerOrders.orderDate,
      partyName: customerOrders.partyName,
      salesPerson: customerOrders.salesPerson,
      agent: customerOrders.agent,
      transport: customerOrders.transport,
      crrCustomerId: crmFollowups.crrCustomerId,
      status: crmFollowups.status,
      deliveryBasis: crmFollowups.deliveryBasis,
      deliveredAt: crmFollowups.deliveredAt,
      dueAt: crmFollowups.dueAt,
      contactedAt: crmFollowups.contactedAt,
      attemptCount: crmFollowups.attemptCount,
      isEscalated: crmFollowups.isEscalated,
      systemOnTime: crmFollowups.systemOnTime,
      ratingOverall: crmFollowups.ratingOverall,
      assignedTo: crmFollowups.assignedTo,
      assignedName: users.name,
      value: orderAgg.value,
      qty: orderAgg.qty,
      designs: orderAgg.designs,
      qualities: orderAgg.qualities,
      hadCancellation: orderAgg.hadCancellation,
      oos: oosAgg.oos,
      openIssues: issueAgg.open,
      highIssue: issueAgg.high,
    })
    .from(crmFollowups)
    .innerJoin(customerOrders, eq(customerOrders.id, crmFollowups.orderId))
    .leftJoin(orderAgg, eq(orderAgg.orderId, crmFollowups.orderId))
    .leftJoin(oosAgg, eq(oosAgg.orderId, crmFollowups.orderId))
    .leftJoin(issueAgg, eq(issueAgg.followupId, crmFollowups.id))
    .leftJoin(users, eq(users.id, crmFollowups.assignedTo))
    .where(where.length ? and(...where) : undefined)
    .limit(MAX_ROWS);

  const now = Date.now();
  const day = 86_400_000;

  // Priority is computed HERE, in JS, by followupPriority() — not in SQL.
  // CLAUDE.md §8 puts every CRM derivation in lib/crm.ts and nowhere else, and
  // a second copy of the ranking rule inside a CTE is exactly the drift that
  // rule exists to prevent. The set is bounded by MAX_ROWS, so sorting it here
  // costs nothing worth trading the single source of truth for.
  const rows: FollowupRow[] = raw.map((r) => {
    const delivered = r.deliveredAt ? new Date(r.deliveredAt).getTime() : now;
    const due = r.dueAt ? new Date(r.dueAt).getTime() : now;
    const orderValue = Number(r.value ?? 0);
    const daysOverdue = Math.floor((now - due) / day);
    const priority = followupPriority({
      orderValue,
      systemOnTime: r.systemOnTime,
      hadOutOfStock: !!r.oos,
      hadCancellation: !!r.hadCancellation,
      priorHighSeverity: !!r.highIssue,
      daysOverdue,
    });
    return {
      id: r.id,
      orderId: r.orderId,
      orderNo: r.orderNo,
      orderDate: r.orderDate,
      partyName: r.partyName,
      salesPerson: r.salesPerson,
      agent: r.agent,
      transport: r.transport,
      crrCustomerId: r.crrCustomerId,
      status: r.status as FollowupStatus,
      deliveryBasis: r.deliveryBasis,
      deliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toISOString() : null,
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
      contactedAt: r.contactedAt ? new Date(r.contactedAt).toISOString() : null,
      attemptCount: r.attemptCount,
      isEscalated: r.isEscalated,
      systemOnTime: r.systemOnTime,
      ratingOverall: r.ratingOverall,
      assignedTo: r.assignedTo,
      assignedName: r.assignedName,
      orderValue,
      qtyMtr: Number(r.qty ?? 0),
      designs: Number(r.designs ?? 0),
      qualities: Number(r.qualities ?? 0),
      openIssues: Number(r.openIssues ?? 0),
      hadOutOfStock: !!r.oos,
      hadCancellation: !!r.hadCancellation,
      daysWaiting: Math.max(0, Math.floor((now - delivered) / day)),
      daysOverdue,
      priority,
      band: priorityBand(priority),
    };
  });

  // KPI counts describe the WHOLE matching set, not the page — so they stay
  // true as the coordinator pages through, and can filter in place.

  // One definition per card, used for BOTH the count above and the filter below.
  const KPI_MATCH: Record<string, (r: FollowupRow) => boolean> = {
    // "Due", not "due today": everything still awaiting its first call that
    // has not yet passed its SLA. A literal same-day predicate reads 0 on most
    // days with a 2-day SLA, which makes the card dead space.
    dueToday: (r) => r.status === "DUE" && r.daysOverdue <= 0,
    overdue: (r) =>
      r.daysOverdue > 0 && (r.status === "DUE" || r.status === "IN_PROGRESS"),
    inProgress: (r) => r.status === "IN_PROGRESS",
    completed30d: (r) =>
      r.status === "COMPLETED" &&
      r.contactedAt !== null &&
      now - new Date(r.contactedAt).getTime() <= 30 * day,
    unreachable: (r) => r.status === "UNREACHABLE",
  };

  const match = kpi ? KPI_MATCH[kpi] : undefined;
  const shown = match ? rows.filter(match) : rows;

  shown.sort((a, b) => {
    if (sort === "oldest") {
      return (a.deliveredAt ?? "").localeCompare(b.deliveredAt ?? "");
    }
    if (sort === "value") return b.orderValue - a.orderValue;
    // Ties broken by order_no so the order is stable across refetches, rather
    // than falling out in whatever order the database happened to return.
    return b.priority - a.priority || a.orderNo.localeCompare(b.orderNo);
  });

  // KPI counts always describe the WHOLE matching set, never the active card's
  // subset — otherwise selecting one card would zero the other four.
  const kpis = {
    dueToday: rows.filter(KPI_MATCH.dueToday).length,
    overdue: rows.filter(KPI_MATCH.overdue).length,
    inProgress: rows.filter(KPI_MATCH.inProgress).length,
    completed30d: rows.filter(KPI_MATCH.completed30d).length,
    unreachable: rows.filter(KPI_MATCH.unreachable).length,
  };

  const total = shown.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;

  return {
    rows: shown.slice(start, start + PAGE_SIZE),
    total,
    page: safePage,
    totalPages,
    kpis,
    created,
  };
}

// ---------------------------------------------------------------------------
// The issues board (§12.5, OE-P17)
// ---------------------------------------------------------------------------

const ISSUE_PAGE_SIZE = 25;
const MAX_ISSUES = 2000;

/**
 * The complaint log, with the counts the board needs.
 *
 * Same shape of decision as loadFollowups: pull the bounded matching set, derive
 * in JS, then page. Age, value-at-risk and the median all need per-row maths
 * that would otherwise be a second copy of the rules in SQL.
 */
export async function loadIssues(p: URLSearchParams): Promise<IssueList> {
  const page = Math.max(1, Number(p.get("page") ?? "1") || 1);
  const status = p.get("status") ?? "OPEN_ANY";
  const category = p.get("category")?.trim() ?? "";
  const severity = p.get("severity")?.trim() ?? "";
  const dept = p.get("dept")?.trim() ?? "";
  const q = p.get("q")?.trim() ?? "";

  // Order value, so "value at risk" means something. Active lines only.
  const orderValue = db.$with("order_value").as(
    db
      .select({
        orderId: orderLineItems.orderId,
        value: sql<string>`coalesce(sum(${orderLineItems.lineTotal}) filter (where not ${orderLineItems.isCancelled}), 0)`.as("value"),
      })
      .from(orderLineItems)
      .where(eq(orderLineItems.isDeleted, false))
      .groupBy(orderLineItems.orderId),
  );

  const where: SQL[] = [];
  if (status === "OPEN_ANY") {
    const m = or(eq(crmIssues.status, "OPEN"), eq(crmIssues.status, "IN_PROGRESS"));
    if (m) where.push(m);
  } else if (status && status !== "ALL") {
    where.push(eq(crmIssues.status, status));
  }
  if (category) where.push(eq(crmIssues.category, category));
  if (severity) where.push(eq(crmIssues.severity, severity));
  if (dept) where.push(eq(crmIssues.ownerDept, dept));
  if (q) {
    const like = `%${q}%`;
    const m = or(
      sql`${crmFollowups.orderNo} ilike ${like}`,
      sql`${customerOrders.partyName} ilike ${like}`,
      sql`${crmIssues.quality} ilike ${like}`,
      sql`${crmIssues.designNo} ilike ${like}`,
    );
    if (m) where.push(m);
  }

  const raw = await db
    .with(orderValue)
    .select({
      id: crmIssues.id,
      followupId: crmIssues.followupId,
      orderId: crmIssues.orderId,
      orderNo: crmFollowups.orderNo,
      partyName: customerOrders.partyName,
      quality: crmIssues.quality,
      designNo: crmIssues.designNo,
      category: crmIssues.category,
      severity: crmIssues.severity,
      ownerDept: crmIssues.ownerDept,
      qtyAffected: crmIssues.qtyAffected,
      description: crmIssues.description,
      status: crmIssues.status,
      resolution: crmIssues.resolution,
      resolutionNote: crmIssues.resolutionNote,
      resolvedAt: crmIssues.resolvedAt,
      resolvedBy: crmIssues.resolvedBy,
      createdAt: crmIssues.createdAt,
      value: orderValue.value,
    })
    .from(crmIssues)
    .innerJoin(crmFollowups, eq(crmFollowups.id, crmIssues.followupId))
    .innerJoin(customerOrders, eq(customerOrders.id, crmFollowups.orderId))
    .leftJoin(orderValue, eq(orderValue.orderId, crmFollowups.orderId))
    .where(where.length ? and(...where) : undefined)
    .limit(MAX_ISSUES);

  const now = Date.now();
  const day = 86_400_000;

  const rows: IssueRow[] = raw.map((r) => {
    const created = new Date(r.createdAt).getTime();
    // Age stops at resolution — a complaint closed in 2 days should not read as
    // 90 days old six months later.
    const end = r.resolvedAt ? new Date(r.resolvedAt).getTime() : now;
    return {
      id: r.id,
      followupId: r.followupId,
      orderId: r.orderId,
      orderNo: r.orderNo,
      partyName: r.partyName,
      quality: r.quality,
      designNo: r.designNo,
      category: r.category as IssueCategory,
      severity: r.severity as IssueSeverity,
      ownerDept: (r.ownerDept as OwnerDept | null) ?? null,
      qtyAffected: r.qtyAffected != null ? Number(r.qtyAffected) : null,
      description: r.description,
      status: r.status as IssueStatus,
      resolution: (r.resolution as IssueResolution | null) ?? null,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
      resolvedBy: r.resolvedBy,
      createdAt: new Date(r.createdAt).toISOString(),
      ageDays: Math.max(0, Math.floor((end - created) / day)),
      orderValue: Number(r.value ?? 0),
    };
  });

  const isOpen = (r: IssueRow) => r.status === "OPEN" || r.status === "IN_PROGRESS";

  // Value at risk counts each ORDER once — three complaints on one order do not
  // put three times its value at risk.
  const riskOrders = new Map<string, number>();
  for (const r of rows) {
    if (isOpen(r) && r.orderId) riskOrders.set(r.orderId, r.orderValue);
  }

  const closed = rows
    .filter((r) => r.resolvedAt)
    .map((r) => r.ageDays)
    .sort((a, b) => a - b);
  const medianResolutionDays = closed.length
    ? closed.length % 2
      ? closed[(closed.length - 1) / 2]
      : (closed[closed.length / 2 - 1] + closed[closed.length / 2]) / 2
    : null;

  const tally = <T extends string>(pick: (r: IssueRow) => T | null) => {
    const m = new Map<T, number>();
    for (const r of rows) {
      const k = pick(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  };

  const kpis = {
    open: rows.filter(isOpen).length,
    valueAtRisk: [...riskOrders.values()].reduce((a, b) => a + b, 0),
    medianResolutionDays,
    highSeverity: rows.filter((r) => isOpen(r) && r.severity === "HIGH").length,
  };

  // Worst first: high severity, then oldest. A board sorted by date buries the
  // complaint that is actually costing money.
  const RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  rows.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      b.ageDays - a.ageDays ||
      a.orderNo.localeCompare(b.orderNo),
  );

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / ISSUE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * ISSUE_PAGE_SIZE;

  return {
    rows: rows.slice(start, start + ISSUE_PAGE_SIZE),
    total,
    page: safePage,
    totalPages,
    kpis,
    byDept: tally((r) => r.ownerDept),
    byCategory: tally((r) => r.category),
  };
}
