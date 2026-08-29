// Canonical database schema — implements CLAUDE.md §5 exactly.
// UUID PKs (gen_random_uuid via defaultRandom), TIMESTAMPTZ default now(),
// quantities numeric(10,2). order_no / quality / design_no / challan_no / lot_no
// are ALWAYS text (varchar) — never numeric.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Every table lives in its OWN Postgres schema, not `public`, so the LD Silk
// Mills Supabase project can host other apps without name collisions — and so
// Supabase's Data API (which only publishes `public`) can never expose orders.
// Drizzle emits fully-qualified "ld_order_entry"."table" in every statement, so
// nothing depends on the connection's search_path (unreliable through a pooler).
// Production is HARD-LOCKED: a stray DB_SCHEMA on Vercel must never be able to
// point the live app at a different schema and make it look empty. Only
// non-production honours the override, so local dev can run against
// `ld_order_entry_dev` without touching real orders.
const PRODUCTION_SCHEMA = "ld_order_entry";
export const SCHEMA_NAME =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_SCHEMA
    : (process.env.DB_SCHEMA?.trim() || PRODUCTION_SCHEMA);

export const app = pgSchema(SCHEMA_NAME);

// Roles (§1). Default VIEWER. MANAGER existed between migrations 0003 and 0006
// but was dropped — its grants were identical to ADMIN's, so it added nothing.
export const userRole = app.enum("user_role", [
  "ADMIN",
  "SALES",
  "OPS",
  "VIEWER",
  // Post-delivery follow-up (§12). Added in migration 0004 — separately from
  // the CRM tables (0003), because Postgres refuses to USE a new enum value in
  // the same transaction that ADDs it, and 0004 seeds role_permissions rows.
  "CRM",
]);

// Per-role capability grants — the admin-editable access matrix (Settings →
// Access). A row (role, capability) with allowed=true means that role has that
// capability. ADMIN is ALWAYS full and is never stored/edited here. Capability
// keys are defined in lib/rbac.ts (CAPABILITIES). Resolved into the session JWT
// at login; changes take effect on the user's next login.
export const rolePermissions = app.table(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRole("role").notNull(),
    capability: varchar("capability", { length: 40 }).notNull(),
    allowed: boolean("allowed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_role_permissions_role_cap").on(t.role, t.capability)],
);

// Allowed lookup categories (§5). Kept as a TS const, not a DB enum — the column
// is VARCHAR(30) per the spec.
export const LOOKUP_CATEGORIES = [
  "PARTY",
  "SALES_PERSON",
  "AGENT",
  "HASTE",
  "TRANSPORT",
  "FABRIC",
] as const;
export type LookupCategory = (typeof LOOKUP_CATEGORIES)[number];

// users ----------------------------------------------------------------------
export const users = app.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 200 }),
  role: userRole("role").notNull().default("VIEWER"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// crr_customers (reference copy of the CRR customer master's alias list) ------
// CRR (crr.linkdprints.com) is the group's customer master. SCOT resolves our
// free-text party names against it. Holding a local copy lets us (a) offer the
// canonical spellings in the Dropdown Master, (b) LINK an order to its CRR
// customer without altering what the operator typed, and (c) emit the CRR
// customer_id on the export, which is SCOT's "gold" exact-match path (Rule 4).
// Refreshed by db/load-crr-customers.ts from the CRR alias export.
export const crrCustomers = app.table(
  "crr_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // CRR's numeric customer id. NOT unique here: one customer has many aliases.
    customerId: integer("customer_id").notNull(),
    // Branch/route marker CRR keeps alongside the name, e.g. "(R)", "(AITK)".
    alias: varchar("alias", { length: 120 }),
    // The spelling exactly as CRR holds it — never cleaned.
    fullRawName: varchar("full_raw_name", { length: 250 }).notNull(),
    // The name we show for this customer: the tidiest spelling on file.
    displayName: varchar("display_name", { length: 250 }).notNull(),
    // Match keys, precomputed by the loader so lookups are a plain index hit.
    // `canon` follows SCOT's scot_canon(); `tight` also folds internal
    // punctuation and trailing plurals, which recovers the bulk of our misses.
    canon: varchar("canon", { length: 250 }).notNull(),
    tight: varchar("tight", { length: 250 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_crr_customers_id_name").on(t.customerId, t.fullRawName),
    index("idx_crr_customers_canon").on(t.canon),
    index("idx_crr_customers_tight").on(t.tight),
    index("idx_crr_customers_customer_id").on(t.customerId),
  ],
);

// customer_orders ------------------------------------------------------------
export const customerOrders = app.table(
  "customer_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNo: varchar("order_no", { length: 50 }).notNull().unique(),
    orderDate: date("order_date").notNull(),
    partyName: varchar("party_name", { length: 200 }).notNull(),
    salesPerson: varchar("sales_person", { length: 100 }),
    agent: varchar("agent", { length: 120 }),
    haste: varchar("haste", { length: 120 }),
    transport: varchar("transport", { length: 120 }),
    challanNo: varchar("challan_no", { length: 100 }),
    lotNo: varchar("lot_no", { length: 100 }),
    department: varchar("department", { length: 40 }).notNull().default("LD"),
    remarks: text("remarks"),
    createdBy: varchar("created_by", { length: 120 }),
    // ---- CRR linkage (added with the SCOT integration) ---------------------
    // The CRR customer this order's party resolves to, when we can establish it
    // confidently. NULL means unresolved — never guessed. Emitted on the export
    // so SCOT can match exactly instead of heuristically (its Rule 4).
    crrCustomerId: integer("crr_customer_id"),
    // What the operator ACTUALLY typed, preserved verbatim whenever party_name
    // or haste is normalised to a CRR spelling. Null = never normalised. This is
    // the audit trail: the order can always be shown, or restored, as written.
    partyNameOriginal: varchar("party_name_original", { length: 200 }),
    hasteOriginal: varchar("haste_original", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_customer_orders_party_name").on(t.partyName),
    index("idx_customer_orders_order_date").on(t.orderDate),
    index("idx_customer_orders_crr_customer").on(t.crrCustomerId),
  ],
);

// order_line_items -----------------------------------------------------------
export const orderLineItems = app.table(
  "order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    quality: varchar("quality", { length: 100 }).notNull(),
    designNo: varchar("design_no", { length: 100 }).notNull(),
    qtyMtr: numeric("qty_mtr", { precision: 10, scale: 2 }).notNull(),
    rate: numeric("rate", { precision: 10, scale: 2 }),
    // GENERATED ALWAYS AS (qty_mtr * rate) STORED — never written directly (§3, §8).
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).generatedAlwaysAs(
      sql`qty_mtr * rate`,
    ),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    // Soft-delete (§ order/design cancellation). A deleted line is hidden from
    // every normal view (list, detail, tracking, order-status, export) and shown
    // only in Trash, where it can be restored. Distinct from isCancelled, which
    // stays visible (struck through). An order with zero non-deleted lines is
    // itself "deleted" (derived — no separate flag on customer_orders).
    isDeleted: boolean("is_deleted").notNull().default(false),
    remarks: text("remarks"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_order_line_items_order_id").on(t.orderId),
    index("idx_order_line_items_quality_design").on(t.quality, t.designNo),
  ],
);

// workflow_stages (seed the 7 + their SLA — the Time Tracking config) --------
export const workflowStages = app.table("workflow_stages", {
  stageKey: varchar("stage_key", { length: 40 }).primaryKey(),
  label: varchar("label", { length: 60 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  // Days from the order's date to this stage's planned deadline (Settings →
  // Time tracking). planned_at = order_date 00:00 + planned_offset_days.
  plannedOffsetDays: integer("planned_offset_days").notNull().default(1),
});

// line_stage_progress --------------------------------------------------------
export const lineStageProgress = app.table(
  "line_stage_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderLineItemId: uuid("order_line_item_id")
      .notNull()
      .references(() => orderLineItems.id, { onDelete: "cascade" }),
    stageKey: varchar("stage_key", { length: 40 })
      .notNull()
      .references(() => workflowStages.stageKey),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    actualAt: timestamp("actual_at", { withTimezone: true }),
    isDone: boolean("is_done").notNull().default(false),
    delayMinutes: integer("delay_minutes"),
    // Only meaningful on the stock_checking row: 'in_stock' | 'out_of_stock'
    // (null = undecided). 'in_stock' is what completes the stage; 'out_of_stock'
    // records the block. Downstream stages stay locked until this is 'in_stock'.
    stockStatus: varchar("stock_status", { length: 20 }),
    updatedBy: varchar("updated_by", { length: 120 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_line_stage_progress_line_stage").on(
      t.orderLineItemId,
      t.stageKey,
    ),
    index("idx_line_stage_progress_line").on(t.orderLineItemId),
  ],
);

// design_database (log of every fabric+design used) -------------------------
// Powers design autocomplete + a browsable history. Denormalized order_no
// survives order deletion (FK is ON DELETE SET NULL).
export const designDatabase = app.table(
  "design_database",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    orderId: uuid("order_id").references(() => customerOrders.id, {
      onDelete: "set null",
    }),
    orderNo: varchar("order_no", { length: 50 }).notNull(),
    fabricName: varchar("fabric_name", { length: 100 }).notNull(),
    designNo: varchar("design_no", { length: 100 }).notNull(),
  },
  (t) => [
    unique("uq_design_database_order_fabric_design").on(
      t.orderNo,
      t.fabricName,
      t.designNo,
    ),
    index("idx_design_database_fabric").on(t.fabricName),
    index("idx_design_database_design").on(t.designNo),
  ],
);

// lookup_values (the Dropdown Master — autocomplete sources) -----------------
export const lookupValues = app.table(
  "lookup_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: varchar("category", { length: 30 }).notNull(),
    value: varchar("value", { length: 200 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // The CRR customer this value resolves to, when one could be established.
    // NULL = not known to CRR (a perfectly normal state - CRR is the group
    // master and we trade with parties it has never opened an account for).
    // Drives the "In CRR" badge in Settings -> Dropdown Master.
    crrCustomerId: integer("crr_customer_id"),
  },
  (t) => [
    index("idx_lookup_values_category").on(t.category),
    index("idx_lookup_values_crr_customer").on(t.crrCustomerId),
  ],
);

// ===========================================================================
// CRM — post-delivery follow-up (§12). One-way dependency: these tables READ
// orders; nothing in the order/stage path ever reads them. No column is added
// to customer_orders or order_line_items — "has this order been followed up?"
// is derived from the presence of a crm_followups row, exactly as CANCELLED
// and deleted are derived from the lines.
// NOTE: crm_* is NOT crr_*. crr_customers is the CRR customer master (§7).
// ===========================================================================

// crm_followups (one per order) ----------------------------------------------
export const crmFollowups = app.table(
  "crm_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // UNIQUE: one follow-up per order (§12.2). This is also what makes the
    // on-read reconcile safe under concurrency — two simultaneous readers both
    // insert, and onConflictDoNothing drops the loser.
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    // Denormalized so an issue raised against this follow-up still names the
    // order after the order itself is purged (same rule as design_database).
    orderNo: varchar("order_no", { length: 50 }).notNull(),
    crrCustomerId: integer("crr_customer_id"),

    status: varchar("status", { length: 20 }).notNull().default("DUE"),
    // How we concluded it was delivered: 'received_lr' (proven) or
    // 'dispatch_transit' (dispatch done + transit_days elapsed).
    deliveryBasis: varchar("delivery_basis", { length: 20 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),

    // Typed on the call. This app holds no phone book and never will.
    contactPerson: varchar("contact_person", { length: 120 }),
    contactPhone: varchar("contact_phone", { length: 30 }),

    // Two fields, never one — the disagreement between them IS the finding.
    // system_on_time is SLA-config-relative, not a performance figure (§12.3).
    systemOnTime: boolean("system_on_time"),
    customerSaysOnTime: boolean("customer_says_on_time"),
    delayReason: varchar("delay_reason", { length: 30 }),

    ratingDelivery: smallint("rating_delivery"),
    ratingQuality: smallint("rating_quality"),
    ratingPacking: smallint("rating_packing"),
    ratingCoordination: smallint("rating_coordination"),
    // Auto-suggested as the mean of the four, and overridable.
    ratingOverall: smallint("rating_overall"),
    ratingSource: varchar("rating_source", { length: 20 }),

    reorderIntent: varchar("reorder_intent", { length: 20 })
      .notNull()
      .default("none"),
    reorderNote: text("reorder_note"),

    // Which lines were delivered when the call was made, so a LATER dispatch
    // on the same order does not silently look followed-up. A UUID array
    // snapshot — never queried by key, so jsonb needs no GIN index.
    deliveredLineIds: jsonb("delivered_line_ids"),
    attemptCount: integer("attempt_count").notNull().default(0),
    notes: text("notes"),
    isEscalated: boolean("is_escalated").notNull().default(false),

    // 'system' when written by the reconcile; an email when written by a person.
    createdBy: varchar("created_by", { length: 120 }),
    completedBy: varchar("completed_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_crm_followups_order").on(t.orderId),
    index("idx_crm_followups_status").on(t.status),
    index("idx_crm_followups_due_at").on(t.dueAt),
    index("idx_crm_followups_crr_customer").on(t.crrCustomerId),
    index("idx_crm_followups_rating_overall").on(t.ratingOverall),
    // A follow-up cannot be COMPLETED without a score — the whole point of the
    // call is the rating, and "done, unrated" would silently poison every
    // average computed over this table.
    check(
      "ck_crm_followups_completed_rating",
      sql`status <> 'COMPLETED' OR rating_overall IS NOT NULL`,
    ),
  ],
);

// crm_followup_attempts (every call, including the unanswered ones) ----------
// Without these rows, "no complaints this month" is indistinguishable from
// "nobody called anyone" — coverage is the honesty metric (§12.7).
export const crmFollowupAttempts = app.table(
  "crm_followup_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    followupId: uuid("followup_id")
      .notNull()
      .references(() => crmFollowups.id, { onDelete: "cascade" }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // 'call' | 'whatsapp' | 'visit' | 'email'
    channel: varchar("channel", { length: 20 }).notNull(),
    // 'connected' | 'no_answer' | 'busy' | 'wrong_number' | 'call_back_later'
    outcome: varchar("outcome", { length: 30 }).notNull(),
    note: text("note"),
    createdBy: varchar("created_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_crm_followup_attempts_followup").on(t.followupId)],
);

// crm_issues (a complaint points at a LINE, never at a text box) -------------
// Because the issue carries order_line_item_id + the denormalized quality and
// design, defect rate is computable by fabric, design, transport, sales person
// and month. Issues outlive their follow-up.
export const crmIssues = app.table(
  "crm_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    followupId: uuid("followup_id")
      .notNull()
      .references(() => crmFollowups.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    orderLineItemId: uuid("order_line_item_id").references(
      () => orderLineItems.id,
      { onDelete: "set null" },
    ),
    // Denormalized so the issue survives a line purge.
    quality: varchar("quality", { length: 100 }),
    designNo: varchar("design_no", { length: 100 }),
    category: varchar("category", { length: 30 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull(),
    // A shortage of 8 m and 800 m are not the same complaint.
    qtyAffected: numeric("qty_affected", { precision: 10, scale: 2 }),
    description: text("description"),
    ownerDept: varchar("owner_dept", { length: 30 }),
    status: varchar("status", { length: 20 }).notNull().default("OPEN"),
    resolution: varchar("resolution", { length: 30 }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: varchar("resolved_by", { length: 120 }),
    createdBy: varchar("created_by", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_crm_issues_status").on(t.status),
    index("idx_crm_issues_category").on(t.category),
    index("idx_crm_issues_owner_dept").on(t.ownerDept),
    index("idx_crm_issues_order").on(t.orderId),
    index("idx_crm_issues_followup").on(t.followupId),
  ],
);

// crm_settings (single row) --------------------------------------------------
// workflow_stages is the SLA config for the STAGES; this is the SLA config for
// the CALL. Seeded by db/seed.ts; edited in Settings.
export const crmSettings = app.table("crm_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Days after dispatch before we assume the goods have landed, when no LR is
  // ticked. Overridable per transport via transport_transit_days.
  transitDaysDefault: integer("transit_days_default").notNull().default(3),
  followupDueDays: integer("followup_due_days").notNull().default(2),
  maxAttempts: integer("max_attempts").notNull().default(3),
  escalateRatingAt: smallint("escalate_rating_at").notNull().default(2),
  // Pauses the on-read reconcile without deleting anything already created.
  autoCreateFollowups: boolean("auto_create_followups").notNull().default(true),
  transportTransitDays: jsonb("transport_transit_days"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Inferred row types for app use.
export type User = typeof users.$inferSelect;
export type CustomerOrder = typeof customerOrders.$inferSelect;
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type WorkflowStage = typeof workflowStages.$inferSelect;
export type LineStageProgress = typeof lineStageProgress.$inferSelect;
export type LookupValue = typeof lookupValues.$inferSelect;
export type DesignDatabaseRow = typeof designDatabase.$inferSelect;
export type CrrCustomer = typeof crrCustomers.$inferSelect;
export type CrmFollowup = typeof crmFollowups.$inferSelect;
export type CrmFollowupAttempt = typeof crmFollowupAttempts.$inferSelect;
export type CrmIssue = typeof crmIssues.$inferSelect;
export type CrmSettings = typeof crmSettings.$inferSelect;
