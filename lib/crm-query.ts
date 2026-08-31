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
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import {
  CRM_DEFAULTS,
  customerSignal,
  followupDueAt,
  followupPriority,
  priorityBand,
  type CrmAnalytics,
  type CrmConfig,
  type CustomerList,
  type CustomerRow,
  type CustomerSort,
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
export type {
  CustomerList,
  CustomerRow,
  CustomerSort,
  FollowupList,
  FollowupRow,
  FollowupSort,
  IssueList,
  IssueRow,
};
import {
  crmFollowupRatings,
  crmFollowups,
  crmIssues,
  crmRatingCriteria,
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
  // Window on when the complaint was RAISED, not on the order date: this board
  // answers "what came in this month", and an old order can produce a new
  // complaint.
  const from = (p.get("from") ?? "").trim() || null;
  const to = (p.get("to") ?? "").trim() || null;

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
  if (from) where.push(sql`${crmIssues.createdAt} >= ${from}::date`);
  // Inclusive of the end day: a "to" of the 31st must include the 31st, not
  // stop at midnight on its first second.
  if (to) where.push(sql`${crmIssues.createdAt} < (${to}::date + interval '1 day')`);
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

// ---------------------------------------------------------------------------
// Customers (§12.5.4, OE-P18)
// ---------------------------------------------------------------------------

const CUSTOMER_PAGE_SIZE = 25;

/**
 * The customer roll-up. ONE statement on purpose — see the concurrency warning
 * at the top of this file — with paging and sorting done in JS afterwards,
 * exactly as loadIssues does.
 *
 * Grouping: `crr_customer_id` when the order carries one, otherwise the party
 * name upper-cased. That is the §12.5.4 rule, and it has a consequence worth
 * stating plainly: two spellings of one company where only one resolved to CRR
 * appear as TWO rows. The fix is more CRR linkage, not fuzzier grouping here —
 * deciding that two party names are one company is exactly the merge the SCOT
 * alias guide (Rule 2) forbids us to make unilaterally.
 *
 * Every follow-up and issue figure is LEFT-joined, so a customer nobody has
 * called yet reads as "no data" (null) and never as a zero rating.
 */
export async function loadCustomers(p: URLSearchParams): Promise<CustomerList> {
  const q = (p.get("q") ?? "").trim().toLowerCase();
  const sort = (p.get("sort") ?? "value") as CustomerSort;
  const rated = p.get("rated"); // "low" | "high" | "any" | null
  // Both drive the KPI tiles, which filter the list to what they count.
  const linked = p.get("linked"); // "yes" | "no" | null
  const signal = p.get("signal"); // "at_risk" | null
  const page = Math.max(1, Number(p.get("page") ?? 1) || 1);
  // Optional order-date window. When set, a customer with no order inside it
  // drops out of the list entirely rather than appearing with zeroes — the
  // question being asked is "who bought in this period", and a row of dashes
  // is not an answer to it.
  const from = (p.get("from") ?? "").trim() || null;
  const to = (p.get("to") ?? "").trim() || null;

  const rows = await db.execute<{
    key: string;
    name: string;
    crr_customer_id: number | null;
    aliases: string[] | null;
    orders_12m: number;
    value_12m: string;
    orders_all: number;
    avg_rating: string | null;
    rated_count: number;
    rating_recent: string | null;
    rating_older: string | null;
    open_issues: number;
    total_issues: number;
    last_contacted: string | null;
    last_order_date: string | null;
    first_order_date: string | null;
    reorder_intent: string | null;
    followups_due: number;
  }>(sql`
    with order_value as (
      select o.id,
             o.crr_customer_id,
             o.party_name,
             o.order_date,
             coalesce(sum(li.line_total) filter (
               where not li.is_cancelled and not li.is_deleted), 0) as value,
             count(*) filter (where not li.is_deleted)              as live_lines
      from ${customerOrders} o
      join ${orderLineItems} li on li.order_id = o.id
      group by o.id, o.crr_customer_id, o.party_name, o.order_date
    ),
    -- An order whose every line is deleted is itself deleted, and a window
    -- (when given) decides which orders count at all.
    live as (
      select * from order_value
      where live_lines > 0
        and (${from}::date is null or order_date >= ${from}::date)
        and (${to}::date is null or order_date <= ${to}::date)
    ),
    grouped as (
      select coalesce('crr:' || crr_customer_id::text, 'raw:' || upper(party_name)) as key,
             min(crr_customer_id) as crr_customer_id,
             (array_agg(party_name order by order_date desc))[1] as name,
             array_agg(distinct party_name) as aliases,
             count(*) filter (where order_date >= current_date - 365) as orders_12m,
             coalesce(sum(value) filter (where order_date >= current_date - 365), 0) as value_12m,
             count(*) as orders_all,
             max(order_date) as last_order_date,
             min(order_date) as first_order_date
      from live group by 1
    ),
    ranked_fu as (
      select f.rating_overall, f.contacted_at, f.status, f.reorder_intent,
             coalesce('crr:' || o.crr_customer_id::text, 'raw:' || upper(o.party_name)) as key,
             row_number() over (
               partition by coalesce('crr:' || o.crr_customer_id::text, 'raw:' || upper(o.party_name))
               order by f.contacted_at desc nulls last) as rn
      from ${crmFollowups} f
      join ${customerOrders} o on o.id = f.order_id
    ),
    fu as (
      select key,
             avg(rating_overall) as avg_rating,
             count(*) filter (where rating_overall is not null) as rated_count,
             avg(rating_overall) filter (where rn <= 3) as rating_recent,
             avg(rating_overall) filter (where rn between 4 and 6) as rating_older,
             max(contacted_at) as last_contacted,
             count(*) filter (where status in ('DUE','IN_PROGRESS')) as followups_due,
             (array_agg(reorder_intent order by contacted_at desc nulls last)
               filter (where reorder_intent is not null and reorder_intent <> 'none'))[1]
               as reorder_intent
      from ranked_fu group by key
    ),
    iss as (
      select coalesce('crr:' || o.crr_customer_id::text, 'raw:' || upper(o.party_name)) as key,
             count(*) filter (where i.status in ('OPEN','IN_PROGRESS')) as open_issues,
             count(*) as total_issues
      from ${crmIssues} i
      join ${customerOrders} o on o.id = i.order_id
      group by 1
    )
    select g.key, g.name, g.crr_customer_id, g.aliases,
           g.orders_12m, g.value_12m, g.orders_all, g.last_order_date,
           g.first_order_date,
           fu.avg_rating, coalesce(fu.rated_count, 0) as rated_count,
           fu.rating_recent, fu.rating_older,
           fu.last_contacted, fu.reorder_intent,
           coalesce(fu.followups_due, 0) as followups_due,
           coalesce(iss.open_issues, 0)  as open_issues,
           coalesce(iss.total_issues, 0) as total_issues
    from grouped g
    left join fu  on fu.key  = g.key
    left join iss on iss.key = g.key
  `);

  const all: CustomerRow[] = rows.map((r) => {
    const recent = r.rating_recent === null ? null : Number(r.rating_recent);
    const older = r.rating_older === null ? null : Number(r.rating_older);
    return {
      key: r.key,
      name: r.name,
      crrCustomerId: r.crr_customer_id,
      // Only meaningful on a CRR-grouped row; a raw row is one spelling by
      // definition, so echoing it back as its own alias is noise.
      aliases:
        r.crr_customer_id !== null && r.aliases
          ? r.aliases.filter((a) => a !== r.name)
          : [],
      orders12m: Number(r.orders_12m),
      value12m: String(r.value_12m ?? "0"),
      ordersAll: Number(r.orders_all),
      avgRating: r.avg_rating === null ? null : Number(r.avg_rating),
      ratedCount: Number(r.rated_count),
      // Fewer than four rated follow-ups → no trend at all, rather than "flat".
      ratingTrend:
        recent === null || older === null
          ? null
          : Math.round((recent - older) * 100) / 100,
      openIssues: Number(r.open_issues),
      totalIssues: Number(r.total_issues),
      lastContacted: r.last_contacted,
      lastOrderDate: r.last_order_date,
      firstOrderDate: r.first_order_date,
      reorderIntent: (r.reorder_intent as CustomerRow["reorderIntent"]) ?? null,
      followupsDue: Number(r.followups_due),
    };
  });

  const kpis = {
    customers: all.length,
    linked: all.filter((r) => r.crrCustomerId !== null).length,
    unlinked: all.filter((r) => r.crrCustomerId === null).length,
    rated: all.filter((r) => r.avgRating !== null).length,
    atRisk: all.filter((r) => customerSignal(r) === "at_risk").length,
  };

  let out = all;
  if (q) {
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.crrCustomerId ?? "").includes(q) ||
        r.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }
  // A rating filter can only match rated customers; unrated rows drop out
  // rather than being silently treated as 0.
  if (rated === "low") out = out.filter((r) => r.avgRating !== null && r.avgRating <= 3);
  if (rated === "high") out = out.filter((r) => r.avgRating !== null && r.avgRating >= 4);
  if (rated === "any") out = out.filter((r) => r.avgRating !== null);
  if (linked === "yes") out = out.filter((r) => r.crrCustomerId !== null);
  if (linked === "no") out = out.filter((r) => r.crrCustomerId === null);
  if (signal === "at_risk") out = out.filter((r) => customerSignal(r) === "at_risk");

  const cmp: Record<CustomerSort, (a: CustomerRow, b: CustomerRow) => number> = {
    value: (a, b) => Number(b.value12m) - Number(a.value12m),
    orders: (a, b) => b.orders12m - a.orders12m || Number(b.value12m) - Number(a.value12m),
    issues: (a, b) => b.openIssues - a.openIssues || Number(b.value12m) - Number(a.value12m),
    // Unrated customers sort last on a rating sort — they are not "worst".
    rating: (a, b) =>
      (a.avgRating ?? Infinity) - (b.avgRating ?? Infinity) ||
      Number(b.value12m) - Number(a.value12m),
    name: (a, b) => a.name.localeCompare(b.name),
    // By ORDER DATE, not by when the row was created — "newest customer" means
    // whoever ordered most recently.
    newest: (a, b) => (b.lastOrderDate ?? "").localeCompare(a.lastOrderDate ?? ""),
    oldest: (a, b) => (a.firstOrderDate ?? "").localeCompare(b.firstOrderDate ?? ""),
  };
  out = [...out].sort(cmp[sort] ?? cmp.value);

  const total = out.length;
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * CUSTOMER_PAGE_SIZE;

  return {
    rows: out.slice(start, start + CUSTOMER_PAGE_SIZE),
    total,
    page: safePage,
    totalPages,
    kpis,
  };
}

// ---------------------------------------------------------------------------
// CRM analytics (§12.5.5, OE-P18)
// ---------------------------------------------------------------------------

/**
 * Everything the analytics screen plots, in FOUR sequential statements — see
 * the concurrency warning at the top of this file. Sequential, not a
 * Promise.all: the pool holds five connections for the whole process.
 *
 * Every figure here is derived from work a coordinator actually did. With an
 * unworked queue they are all legitimately zero or null, and the screen says
 * so rather than drawing a convincing flat line. `sampleSize` exists for
 * exactly that: it lets the UI distinguish "nothing is wrong" from "nobody has
 * looked yet", which are the two readings a blank chart could carry.
 */
export async function loadCrmAnalytics(
  p: URLSearchParams,
): Promise<CrmAnalytics> {
  const from = (p.get("from") ?? "").trim() || null;
  const to = (p.get("to") ?? "").trim() || null;

  // Window on the follow-up's delivery date — the event the call is about.
  const win = sql`
    (${from}::date is null or ${crmFollowups.deliveredAt} >= ${from}::date)
    and (${to}::date is null or ${crmFollowups.deliveredAt} < (${to}::date + interval '1 day'))`;

  // ---- 1. Headline counts, the on-time 2x2, and reorder intent ------------
  const [head] = await db
    .select({
      followups: count(),
      contacted: sql<number>`count(*) filter (where ${crmFollowups.contactedAt} is not null)`,
      completed: sql<number>`count(*) filter (where ${crmFollowups.status} = 'COMPLETED')`,
      unreachable: sql<number>`count(*) filter (where ${crmFollowups.status} = 'UNREACHABLE')`,
      due: sql<number>`count(*) filter (where ${crmFollowups.status} = 'DUE')`,
      inProgress: sql<number>`count(*) filter (where ${crmFollowups.status} = 'IN_PROGRESS')`,
      notRequired: sql<number>`count(*) filter (where ${crmFollowups.status} = 'NOT_REQUIRED')`,
      escalated: sql<number>`count(*) filter (where ${crmFollowups.isEscalated})`,
      rated: sql<number>`count(*) filter (where ${crmFollowups.ratingOverall} is not null)`,
      avgOverall: sql<string | null>`avg(${crmFollowups.ratingOverall})`,
      // The SLA calibration 2x2 (§12.3). Where these disagree is the finding.
      bothOnTime: sql<number>`count(*) filter (where ${crmFollowups.systemOnTime} and ${crmFollowups.customerSaysOnTime})`,
      bothLate: sql<number>`count(*) filter (where ${crmFollowups.systemOnTime} = false and ${crmFollowups.customerSaysOnTime} = false)`,
      weLateTheyFine: sql<number>`count(*) filter (where ${crmFollowups.systemOnTime} = false and ${crmFollowups.customerSaysOnTime})`,
      weOnTimeTheyNot: sql<number>`count(*) filter (where ${crmFollowups.systemOnTime} and ${crmFollowups.customerSaysOnTime} = false)`,
      reorderYes: sql<number>`count(*) filter (where ${crmFollowups.reorderIntent} = 'yes')`,
      reorderMaybe: sql<number>`count(*) filter (where ${crmFollowups.reorderIntent} = 'maybe')`,
      reorderSample: sql<number>`count(*) filter (where ${crmFollowups.reorderIntent} = 'sample_requested')`,
    })
    .from(crmFollowups)
    .where(win);

  // ---- 2. Rating trend by month, plus the sub-scores ----------------------
  // Sub-scores join through crm_rating_criteria because criteria are
  // configurable now (§12.4) — nothing here may name delivery/quality/etc.
  const trend = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${crmFollowups.contactedAt}), 'YYYY-MM')`,
      avg: sql<string>`avg(${crmFollowups.ratingOverall})`,
      n: count(),
    })
    .from(crmFollowups)
    .where(and(win, isNotNull(crmFollowups.ratingOverall), isNotNull(crmFollowups.contactedAt)))
    .groupBy(sql`date_trunc('month', ${crmFollowups.contactedAt})`)
    .orderBy(sql`date_trunc('month', ${crmFollowups.contactedAt})`);

  const subs = await db
    .select({
      key: crmFollowupRatings.criterionKey,
      label: sql<string | null>`max(${crmRatingCriteria.label})`,
      avg: sql<string>`avg(${crmFollowupRatings.value})`,
      n: count(),
    })
    .from(crmFollowupRatings)
    .innerJoin(crmFollowups, eq(crmFollowups.id, crmFollowupRatings.followupId))
    .leftJoin(crmRatingCriteria, eq(crmRatingCriteria.key, crmFollowupRatings.criterionKey))
    .where(win)
    .groupBy(crmFollowupRatings.criterionKey);

  // ---- 3. Complaints: by category, by department, by transport -----------
  const issues = await db
    .select({
      category: crmIssues.category,
      dept: crmIssues.ownerDept,
      transport: customerOrders.transport,
      status: crmIssues.status,
      createdAt: crmIssues.createdAt,
      resolvedAt: crmIssues.resolvedAt,
    })
    .from(crmIssues)
    .innerJoin(crmFollowups, eq(crmFollowups.id, crmIssues.followupId))
    .innerJoin(customerOrders, eq(customerOrders.id, crmFollowups.orderId))
    .where(win);

  const tally = (pick: (r: (typeof issues)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const r of issues) {
      const k = pick(r);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Median, not mean: one complaint left open for a year would drag a mean
  // into uselessness and hide that most are closed in a week.
  const closed = issues
    .filter((r) => r.resolvedAt)
    .map(
      (r) =>
        (new Date(r.resolvedAt as unknown as string).getTime() -
          new Date(r.createdAt as unknown as string).getTime()) /
        86_400_000,
    )
    .sort((a, b) => a - b);
  const medianTat =
    closed.length === 0
      ? null
      : Math.round(closed[Math.floor(closed.length / 2)] * 10) / 10;

  const followups = Number(head?.followups ?? 0);
  const contacted = Number(head?.contacted ?? 0);

  return {
    window: { from, to },
    // The honesty metric (§9). Coverage is the FIRST thing to read: with it
    // low, every other figure on this page describes a handful of calls.
    coverage: {
      followups,
      contacted,
      pct: followups === 0 ? null : Math.round((contacted / followups) * 1000) / 10,
    },
    funnel: {
      due: Number(head?.due ?? 0),
      inProgress: Number(head?.inProgress ?? 0),
      completed: Number(head?.completed ?? 0),
      unreachable: Number(head?.unreachable ?? 0),
      notRequired: Number(head?.notRequired ?? 0),
    },
    ratings: {
      rated: Number(head?.rated ?? 0),
      avgOverall: head?.avgOverall == null ? null : Number(head.avgOverall),
      escalated: Number(head?.escalated ?? 0),
      trend: trend.map((r) => ({
        month: r.month,
        avg: Math.round(Number(r.avg) * 100) / 100,
        n: Number(r.n),
      })),
      subs: subs
        .map((r) => ({
          key: r.key,
          label: r.label ?? r.key,
          avg: Math.round(Number(r.avg) * 100) / 100,
          n: Number(r.n),
        }))
        .sort((a, b) => a.avg - b.avg),
    },
    onTime: {
      bothOnTime: Number(head?.bothOnTime ?? 0),
      bothLate: Number(head?.bothLate ?? 0),
      weLateTheyFine: Number(head?.weLateTheyFine ?? 0),
      weOnTimeTheyNot: Number(head?.weOnTimeTheyNot ?? 0),
    },
    complaints: {
      total: issues.length,
      open: issues.filter((r) => r.status === "OPEN" || r.status === "IN_PROGRESS").length,
      byCategory: tally((r) => r.category),
      byDept: tally((r) => r.dept),
      byTransport: tally((r) => r.transport),
      medianTatDays: medianTat,
      // Per 100 delivered orders — a raw count just ranks your busiest
      // transporter first, which is not a quality signal.
      ratePer100: followups === 0 ? null : Math.round((issues.length / followups) * 1000) / 10,
    },
    reorder: {
      yes: Number(head?.reorderYes ?? 0),
      maybe: Number(head?.reorderMaybe ?? 0),
      sample: Number(head?.reorderSample ?? 0),
    },
    /** How much work these numbers rest on — 0 means nobody has called yet. */
    sampleSize: Number(head?.completed ?? 0),
  };
}
