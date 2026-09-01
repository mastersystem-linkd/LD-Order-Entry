// CRM derivations — the post-delivery follow-up module (CLAUDE.md §12).
//
// This file is to the CRM what lib/workflow.ts is to the stages: the ONE place
// that decides what "delivered" means, what a rating rolls up to, what gets
// escalated, and what order the queue is worked in. Nothing else may re-derive
// any of it.
//
// Dependency direction is one-way: CRM reads orders, orders never read CRM —
// lib/workflow.ts must never import from here.
//
// ⚠️ And this file must import NOTHING. It is pulled into client components
// (the queue and the call panel), and lib/workflow.ts imports `dbx` from
// lib/db, which imports postgres.js — so a single convenience import of a stage
// constant from workflow.ts drags `fs`, `net` and `tls` into the browser bundle
// and the Turbopack build fails with "Module not found: Can't resolve 'fs'".
// Anything CRM needs from the stage layer is passed IN by the server caller.

// ---------------------------------------------------------------------------
// Vocabularies. Kept as TS consts rather than PG enums: the house pattern for
// small value sets is VARCHAR + a documented list (stock_status, lookup
// category). Only user_role is a real database enum.
// ---------------------------------------------------------------------------

export const FOLLOWUP_STATUSES = [
  "DUE",
  "IN_PROGRESS",
  "COMPLETED",
  "UNREACHABLE",
  "NOT_REQUIRED",
] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const DELIVERY_BASES = ["received_lr", "dispatch_transit"] as const;
export type DeliveryBasis = (typeof DELIVERY_BASES)[number];

export const DELAY_REASONS = [
  "transport",
  "our_dispatch",
  "customer_side",
  "unknown",
] as const;
export type DelayReason = (typeof DELAY_REASONS)[number];

export const RATING_SOURCES = ["customer", "coordinator"] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

export const REORDER_INTENTS = [
  "none",
  "maybe",
  "yes",
  "sample_requested",
] as const;
export type ReorderIntent = (typeof REORDER_INTENTS)[number];

export const ATTEMPT_CHANNELS = ["call", "whatsapp", "visit", "email"] as const;
export type AttemptChannel = (typeof ATTEMPT_CHANNELS)[number];

export const ATTEMPT_OUTCOMES = [
  "connected",
  "no_answer",
  "busy",
  "wrong_number",
  "call_back_later",
  // Visits. A visit cannot be "busy" or a "wrong number", and WHERE it
  // happened is the useful fact: a customer who came to us is a different
  // signal from one we had to travel to.
  "met_at_our_office",
  "met_at_customer_place",
  "not_available",
] as const;
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

/**
 * Which outcomes make sense for each channel. Offering "Busy" for a visit or
 * "Met at our office" for a WhatsApp is how a dropdown teaches people that the
 * form was not built for their job.
 */
export const CHANNEL_OUTCOMES: Record<AttemptChannel, AttemptOutcome[]> = {
  call: ["connected", "no_answer", "busy", "wrong_number", "call_back_later"],
  whatsapp: ["connected", "no_answer", "wrong_number", "call_back_later"],
  visit: ["met_at_our_office", "met_at_customer_place", "not_available"],
  email: ["connected", "no_answer", "call_back_later"],
};

/**
 * Did we actually reach the customer? Coverage and the UNREACHABLE rule both
 * depend on this, and neither may assume "reached" means the single value
 * "connected" — meeting someone in person is the strongest contact there is.
 */
export function isReachedOutcome(outcome: string): boolean {
  return (
    outcome === "connected" ||
    outcome === "met_at_our_office" ||
    outcome === "met_at_customer_place"
  );
}

/**
 * Complaint categories are DATA, not a union. A fixed list could not survive
 * contact with real calls — customers complain about whatever they complain
 * about — so a category is free text, drawn from lookup_values("CRM_ISSUE"),
 * managed in Settings → CRM, and addable mid-call. Same rule as fabric and
 * design (§3.4): never block an unknown value.
 *
 * These are the values the module ships with, seeded on first run. Nothing in
 * the code may assume the list still looks like this.
 */
export const DEFAULT_ISSUE_CATEGORIES = [
  "Late delivery",
  "Damage in transit",
  "Shortage in meters",
  "Shade variation",
  "Print defect",
  "Wrong design",
  "Packing",
  "Billing / rate",
  "Other",
] as const;
export type IssueCategory = string;

export const ISSUE_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const OWNER_DEPTS = [
  "OPS",
  "DISPATCH",
  "DESIGN",
  "ACCOUNTS",
  "TRANSPORT",
  "SALES",
] as const;
export type OwnerDept = (typeof OWNER_DEPTS)[number];

export const ISSUE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_RESOLUTIONS = [
  "CREDIT_NOTE",
  "REPLACEMENT",
  "REPRINT",
  "DISCOUNT",
  "EXPLAINED",
  "NO_ACTION",
] as const;
export type IssueResolution = (typeof ISSUE_RESOLUTIONS)[number];

/** Human labels. The UI must never invent its own wording for these. */
/**
 * Kept as a function, not a map: the stored category IS its own label now.
 * Legacy rows written before categories became data still carry the old
 * SCREAMING_SNAKE keys, so those are humanised on the way out rather than
 * rewritten in the database.
 */
const LEGACY_CATEGORY_LABEL: Record<string, string> = {
  LATE_DELIVERY: "Late delivery",
  DAMAGE_TRANSIT: "Damage in transit",
  SHORTAGE_MTR: "Shortage in meters",
  SHADE_VARIATION: "Shade variation",
  PRINT_DEFECT: "Print defect",
  WRONG_DESIGN: "Wrong design",
  PACKING: "Packing",
  BILLING_RATE: "Billing / rate",
  OTHER: "Other",
};

export function categoryLabel(c: string): string {
  // The stored category IS its own label now. Rows written before categories
  // became data carry SCREAMING_SNAKE keys, so those are rendered as they
  // always were rather than rewritten in the database — "DAMAGE_TRANSIT" read
  // "Damage in transit", which no general rule recovers.
  if (LEGACY_CATEGORY_LABEL[c]) return LEGACY_CATEGORY_LABEL[c];
  if (!/^[A-Z][A-Z0-9_]*$/.test(c)) return c;
  const s = c.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const STATUS_LABEL: Record<FollowupStatus, string> = {
  DUE: "Due",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  UNREACHABLE: "Unreachable",
  NOT_REQUIRED: "Not required",
};

export const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
  connected: "Connected",
  no_answer: "No answer",
  busy: "Busy",
  wrong_number: "Wrong number",
  call_back_later: "Call back later",
  met_at_our_office: "Met — at our office",
  met_at_customer_place: "Met — at their place",
  not_available: "Not available",
};

export const CHANNEL_LABEL: Record<AttemptChannel, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  visit: "Visit",
  email: "Email",
};

export const DELAY_REASON_LABEL: Record<DelayReason, string> = {
  transport: "Transport",
  our_dispatch: "Our dispatch",
  customer_side: "Customer side",
  unknown: "Unknown",
};

/** Defaults, mirrored by the crm_settings row (§12). */
export const CRM_DEFAULTS = {
  transitDaysDefault: 3,
  followupDueDays: 2,
  maxAttempts: 3,
  escalateRatingAt: 2,
  autoCreateFollowups: true,
} as const;

export type CrmConfig = {
  transitDaysDefault: number;
  followupDueDays: number;
  maxAttempts: number;
  escalateRatingAt: number;
  autoCreateFollowups: boolean;
  transportTransitDays: Record<string, number> | null;
};

/** Transit allowance for a transport, falling back to the global default. */
export function transitDaysFor(cfg: CrmConfig, transport: string | null): number {
  if (transport && cfg.transportTransitDays) {
    const v = cfg.transportTransitDays[transport];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return cfg.transitDaysDefault;
}

// ---------------------------------------------------------------------------
// Delivered — the trigger (§12.1)
// ---------------------------------------------------------------------------

/** The stage facts this module needs about one active line. */
export type LineDelivery = {
  /** `received_lr` ticked — delivery is proven. */
  receivedLrDone: boolean;
  /** `dispatch` ticked. */
  dispatchDone: boolean;
  /** When dispatch was ticked. Null means we cannot start the transit clock. */
  dispatchAt: Date | null;
};

export type DeliveryVerdict =
  | { delivered: false }
  | { delivered: true; basis: DeliveryBasis; at: Date };

/**
 * Is ONE line delivered?
 *
 * Two paths, deliberately (§12.1). `received_lr` proves it. Failing that,
 * `dispatch` plus the transit allowance is the honest approximation — ops tick
 * LR unevenly, and an LR-only rule would leave the coordinator staring at an
 * empty queue while customers wait uncalled.
 *
 * A dispatch with no `actual_at` is NOT delivered: without a timestamp there is
 * no clock to run, and guessing one would silently backdate the call.
 */
export function isLineDelivered(
  line: LineDelivery,
  transitDays: number,
  now: Date = new Date(),
): DeliveryVerdict {
  if (line.receivedLrDone) {
    return { delivered: true, basis: "received_lr", at: line.dispatchAt ?? now };
  }
  if (line.dispatchDone && line.dispatchAt) {
    const landed = new Date(
      line.dispatchAt.getTime() + transitDays * 86_400_000,
    );
    if (landed <= now) {
      return { delivered: true, basis: "dispatch_transit", at: landed };
    }
  }
  return { delivered: false };
}

/**
 * Is a whole ORDER delivered? Only when EVERY active line is.
 *
 * `lines` must already be filtered to active — non-cancelled AND non-deleted,
 * the same predicate the rest of the app uses. An order with zero active lines
 * never enters the queue: there is nothing to have delivered.
 *
 * The order's delivered-at is the LAST line to land, not the first — the
 * customer received the order when the final piece of it arrived.
 */
export function isDelivered(
  lines: LineDelivery[],
  transitDays: number,
  now: Date = new Date(),
): DeliveryVerdict {
  if (lines.length === 0) return { delivered: false };
  let at: Date | null = null;
  // If any line landed only because of the transit rule, the order's basis is
  // the weaker of the two — we should not claim an LR proved the whole order.
  let basis: DeliveryBasis = "received_lr";
  for (const line of lines) {
    const v = isLineDelivered(line, transitDays, now);
    if (!v.delivered) return { delivered: false };
    if (v.basis === "dispatch_transit") basis = "dispatch_transit";
    if (!at || v.at > at) at = v.at;
  }
  return { delivered: true, basis, at: at ?? now };
}

/** When the call is due: delivery + the configured SLA, in whole days. */
export function followupDueAt(deliveredAt: Date, dueDays: number): Date {
  return new Date(deliveredAt.getTime() + dueDays * 86_400_000);
}

// ---------------------------------------------------------------------------
// Ratings (§12.4)
// ---------------------------------------------------------------------------

/**
 * Scores by criterion key. These were four fixed fields (delivery / quality /
 * packing / coordination); they are configurable rows now (§12.4), so nothing
 * here may name a specific criterion.
 */
export type SubRatings = Record<string, number | null | undefined>;

/** A rating criterion as configured in Settings → CRM. */
export type RatingCriterion = {
  key: string;
  label: string;
  hint: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** The criteria the module ships with, seeded on first run. */
export const DEFAULT_RATING_CRITERIA: {
  key: string;
  label: string;
  hint: string;
}[] = [
  { key: "delivery", label: "Delivery", hint: "timeliness, handling" },
  { key: "quality", label: "Quality", hint: "fabric, print, shade" },
  { key: "packing", label: "Packing", hint: "condition on arrival" },
  { key: "coordination", label: "Coordination", hint: "our communication" },
];

function givenScores(r: SubRatings): number[] {
  return Object.values(r).filter(
    (v): v is number => typeof v === "number" && v >= 1 && v <= 5,
  );
}

/**
 * The suggested overall — the mean of whichever sub-ratings were given, rounded
 * to the nearest star. Returns null when none were, so the UI shows an empty
 * picker rather than a confident 0.
 *
 * It is only ever a SUGGESTION: the coordinator may override it, and
 * `rating_source` records who the number actually came from.
 */
export function deriveOverallRating(r: SubRatings): number | null {
  const given = givenScores(r);
  if (given.length === 0) return null;
  const mean = given.reduce((a, b) => a + b, 0) / given.length;
  return Math.min(5, Math.max(1, Math.round(mean)));
}

/** The un-rounded mean, for display beside the stars ("3.3"). */
export function overallRatingExact(r: SubRatings): number | null {
  const given = givenScores(r);
  if (given.length === 0) return null;
  return given.reduce((a, b) => a + b, 0) / given.length;
}

/**
 * Escalation (§12.6) — an in-app flag, nothing more. A low overall OR any
 * high-severity issue puts the follow-up in front of the principal.
 */
export function shouldEscalate(
  ratingOverall: number | null,
  hasHighSeverityIssue: boolean,
  escalateAt: number = CRM_DEFAULTS.escalateRatingAt,
): boolean {
  if (hasHighSeverityIssue) return true;
  return typeof ratingOverall === "number" && ratingOverall <= escalateAt;
}

// ---------------------------------------------------------------------------
// State machine (§12)
// ---------------------------------------------------------------------------

/**
 * Where a follow-up goes when an attempt is logged.
 *
 * DUE → IN_PROGRESS on the first attempt. Enough failed attempts → UNREACHABLE,
 * which is reopenable. A connected call does NOT complete the follow-up — only
 * a rating does, because an unrated call recorded no information.
 * COMPLETED and NOT_REQUIRED are terminal against attempts: logging another
 * call must not silently reopen a finished record.
 */
export function statusAfterAttempt(
  current: FollowupStatus,
  attemptCount: number,
  outcome: AttemptOutcome,
  maxAttempts: number = CRM_DEFAULTS.maxAttempts,
): FollowupStatus {
  if (current === "COMPLETED" || current === "NOT_REQUIRED") return current;
  // Any outcome that REACHED the customer keeps this live — meeting them at
  // our counter is contact, and counting it toward "unreachable" would be
  // absurd. Checked through isReachedOutcome so the visit outcomes are
  // included, not just the single value "connected".
  if (isReachedOutcome(outcome)) return "IN_PROGRESS";
  if (attemptCount >= maxAttempts) return "UNREACHABLE";
  return "IN_PROGRESS";
}

/**
 * A follow-up may only be COMPLETED with an overall rating — enforced here AND
 * by ck_crm_followups_completed_rating in the database, because a "done,
 * unrated" row would silently poison every average computed over this table.
 */
export function canComplete(ratingOverall: number | null): boolean {
  return typeof ratingOverall === "number" && ratingOverall >= 1 && ratingOverall <= 5;
}

// ---------------------------------------------------------------------------
// Priority (§12.8)
// ---------------------------------------------------------------------------

export type PriorityInput = {
  /** Σ line_total over active lines. NULL rates make this 0 — see below. */
  orderValue: number;
  /** Our own SLA verdict. False = we were late. */
  systemOnTime: boolean | null;
  /** The order had a line blocked at stock checking. */
  hadOutOfStock: boolean;
  /** The order has at least one cancelled line. */
  hadCancellation: boolean;
  /** This customer has a prior HIGH-severity issue. */
  priorHighSeverity: boolean;
  /** Days past due_at; negative = not yet due. */
  daysOverdue: number;
};

export type PriorityBand = "high" | "medium" | "low";

/**
 * A single comparable score. Higher is worked first.
 *
 * Value is the dominant term but is log-scaled: a ₹18 L order should outrank a
 * ₹40 K one, but not by 45×, or one large order would bury everything else for
 * a week. Orders with no `rate` have a NULL line_total and therefore a value of
 * 0 — they rank low on value alone, and are NOT dropped from the queue.
 */
export function followupPriority(p: PriorityInput): number {
  let score = 0;
  if (p.orderValue > 0) score += Math.log10(p.orderValue + 1) * 10;
  if (p.systemOnTime === false) score += 18;
  if (p.hadOutOfStock) score += 10;
  if (p.hadCancellation) score += 6;
  if (p.priorHighSeverity) score += 22;
  if (p.daysOverdue > 0) score += Math.min(p.daysOverdue, 14) * 3;
  return score;
}

/** The three-step bar the queue shows instead of a bare number. */
export function priorityBand(score: number): PriorityBand {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export const PRIORITY_LABEL: Record<PriorityBand, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};


// ---------------------------------------------------------------------------
// Client-visible shapes
// ---------------------------------------------------------------------------
// These live HERE, not in lib/crm-query.ts, because the queue screen and the
// call panel are client components: importing a type from the query module
// would drag Drizzle and postgres.js onto the browser's module graph. Same
// split as lib/order-status.ts (types) vs lib/order-status-query.ts (queries).

export type FollowupSort = "priority" | "oldest" | "value";

export type FollowupRow = {
  id: string;
  orderId: string;
  orderNo: string;
  orderDate: string;
  partyName: string;
  salesPerson: string | null;
  agent: string | null;
  transport: string | null;
  crrCustomerId: number | null;
  status: FollowupStatus;
  deliveryBasis: string | null;
  deliveredAt: string | null;
  dueAt: string | null;
  contactedAt: string | null;
  attemptCount: number;
  isEscalated: boolean;
  systemOnTime: boolean | null;
  ratingOverall: number | null;
  assignedTo: string | null;
  assignedName: string | null;
  /** Σ line_total over active lines. 0 when no rate is set — see followupPriority. */
  orderValue: number;
  qtyMtr: number;
  designs: number;
  qualities: number;
  openIssues: number;
  hadOutOfStock: boolean;
  hadCancellation: boolean;
  daysWaiting: number;
  daysOverdue: number;
  priority: number;
  band: PriorityBand;
};

export type IssueRow = {
  id: string;
  followupId: string;
  orderId: string | null;
  orderNo: string;
  partyName: string;
  quality: string | null;
  designNo: string | null;
  category: IssueCategory;
  severity: IssueSeverity;
  ownerDept: OwnerDept | null;
  qtyAffected: number | null;
  description: string | null;
  status: IssueStatus;
  resolution: IssueResolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  /** Days open — to resolution if closed, to now if not. */
  ageDays: number;
  /** Σ line_total of the order this issue belongs to. */
  orderValue: number;
};

export type IssueList = {
  rows: IssueRow[];
  total: number;
  page: number;
  totalPages: number;
  kpis: {
    open: number;
    valueAtRisk: number;
    medianResolutionDays: number | null;
    highSeverity: number;
  };
  /** Counts for the group-by rail, over the whole matching set. */
  byDept: { key: string; count: number }[];
  byCategory: { key: IssueCategory; count: number }[];
};

export type FollowupList = {
  rows: FollowupRow[];
  total: number;
  page: number;
  totalPages: number;
  kpis: {
    dueToday: number;
    overdue: number;
    inProgress: number;
    completed30d: number;
    unreachable: number;
  };
  /** How many rows the reconcile created on this request (§12.9). */
  created: number;
};

// ---------------------------------------------------------------------------
// Customers (§12.5.4, OE-P18)
// ---------------------------------------------------------------------------

/**
 * A customer roll-up row. This is a VIEW over orders, follow-ups and issues —
 * never a second customer master, and `name` is always a party name exactly as
 * an operator typed it.
 */
export type CustomerRow = {
  /** Grouping key: the CRR id when we have one, else the raw party name. */
  key: string;
  name: string;
  /** Null when no order of this customer's has been resolved to CRR. */
  crrCustomerId: number | null;
  /** Other spellings folded into this row (only ever when crrCustomerId is set). */
  aliases: string[];
  orders12m: number;
  value12m: string;
  ordersAll: number;
  /** Null until somebody has actually rated a delivered order. */
  avgRating: number | null;
  ratedCount: number;
  /** Recent mean minus older mean; null when there is too little to compare. */
  ratingTrend: number | null;
  openIssues: number;
  totalIssues: number;
  lastContacted: string | null;
  lastOrderDate: string | null;
  /** Earliest order in the window — what "oldest first" actually sorts on. */
  firstOrderDate: string | null;
  reorderIntent: ReorderIntent | null;
  followupsDue: number;
};

export type CustomerSort =
  | "value"
  | "rating"
  | "issues"
  | "orders"
  | "name"
  | "newest"
  | "oldest";

export type CustomerList = {
  rows: CustomerRow[];
  total: number;
  page: number;
  totalPages: number;
  kpis: {
    customers: number;
    linked: number;
    unlinked: number;
    rated: number;
    atRisk: number;
  };
};

/**
 * The commercial read on a customer, in priority order. Deliberately returns
 * exactly one label: a row with a bad rating AND a reorder ask is an at-risk
 * customer first — chasing the reorder before fixing the complaint is how an
 * account is lost.
 */
export type CustomerSignal = "at_risk" | "unhappy" | "reorder" | "sample" | "none";

export function customerSignal(r: {
  avgRating: number | null;
  openIssues: number;
  reorderIntent: ReorderIntent | null;
}): CustomerSignal {
  if (r.openIssues > 0 && r.avgRating !== null && r.avgRating <= 3) return "at_risk";
  if (r.openIssues > 0) return "unhappy";
  if (r.avgRating !== null && r.avgRating <= 2) return "at_risk";
  if (r.reorderIntent === "sample_requested") return "sample";
  if (r.reorderIntent === "yes" || r.reorderIntent === "maybe") return "reorder";
  return "none";
}

export const CUSTOMER_SIGNAL_LABEL: Record<CustomerSignal, string> = {
  at_risk: "At risk",
  unhappy: "Open complaint",
  reorder: "Reorder",
  sample: "Sample asked",
  none: "—",
};

// ---------------------------------------------------------------------------
// Analytics (§12.5.5, OE-P18)
// ---------------------------------------------------------------------------

/**
 * What the CRM analytics screen plots.
 *
 * Nullable figures are deliberate. A coverage of `null` means no follow-up
 * exists to measure, which is a different statement from 0% — and on a screen
 * whose whole purpose is telling "no complaints" apart from "nobody called",
 * conflating the two would be the one unforgivable bug.
 */
export type CrmAnalytics = {
  window: { from: string | null; to: string | null };
  coverage: { followups: number; contacted: number; pct: number | null };
  funnel: {
    due: number;
    inProgress: number;
    completed: number;
    unreachable: number;
    notRequired: number;
  };
  ratings: {
    rated: number;
    avgOverall: number | null;
    escalated: number;
    trend: { month: string; avg: number; n: number }[];
    /** By criterion — configurable, so never a fixed four (§12.4). */
    subs: { key: string; label: string; avg: number; n: number }[];
  };
  /** The SLA calibration 2x2 (§12.3) — the disagreement IS the finding. */
  onTime: {
    bothOnTime: number;
    bothLate: number;
    weLateTheyFine: number;
    weOnTimeTheyNot: number;
  };
  complaints: {
    total: number;
    open: number;
    byCategory: { key: string; count: number }[];
    byDept: { key: string; count: number }[];
    byTransport: { key: string; count: number }[];
    medianTatDays: number | null;
    ratePer100: number | null;
  };
  reorder: { yes: number; maybe: number; sample: number };
  sampleSize: number;
};

// ---------------------------------------------------------------------------
// The call log (§12.5.6)
// ---------------------------------------------------------------------------

/**
 * One worked call, as a record rather than as a task.
 *
 * This exists because three fields were WRITE-ONLY. `notes` (the feedback a
 * customer actually gave), `reorder_note` (what they said they need next) and
 * the per-criterion scores were all written by the call panel and readable
 * nowhere else — a coordinator could record "they want 2,000 m satin crepe in
 * September" and nobody, sales included, could find it again without opening
 * that one order. Complaints had a board; the rest of the call had nothing.
 */
export type CallRecord = {
  followupId: string;
  orderId: string;
  orderNo: string;
  partyName: string;
  crrCustomerId: number | null;
  salesPerson: string | null;
  status: FollowupStatus;
  deliveredAt: string | null;
  contactedAt: string | null;
  completedBy: string | null;
  attempts: number;
  channels: string[];
  customerSaysOnTime: boolean | null;
  delayReason: string | null;
  ratingOverall: number | null;
  ratingSource: string | null;
  /** Per criterion, in the order the criteria are configured. */
  subRatings: { key: string; label: string; value: number }[];
  /** The free-text feedback — the whole reason this screen exists. */
  feedback: string | null;
  reorderIntent: ReorderIntent;
  reorderNote: string | null;
  issues: number;
  openIssues: number;
  orderValue: number;
  isEscalated: boolean;
};

export type CallList = {
  rows: CallRecord[];
  total: number;
  page: number;
  totalPages: number;
  kpis: {
    calls: number;
    withFeedback: number;
    reorderSignals: number;
    escalated: number;
  };
};
