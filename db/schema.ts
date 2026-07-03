// Canonical database schema — implements CLAUDE.md §5 exactly.
// UUID PKs (gen_random_uuid via defaultRandom), TIMESTAMPTZ default now(),
// quantities numeric(10,2). order_no / quality / design_no / challan_no / lot_no
// are ALWAYS text (varchar) — never numeric.
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Roles (§1). Default VIEWER. MANAGER = orders + operations, no settings.
export const userRole = pgEnum("user_role", [
  "ADMIN",
  "SALES",
  "OPS",
  "VIEWER",
  "MANAGER",
]);

// Per-role capability grants — the admin-editable access matrix (Settings →
// Access). A row (role, capability) with allowed=true means that role has that
// capability. ADMIN is ALWAYS full and is never stored/edited here. Capability
// keys are defined in lib/rbac.ts (CAPABILITIES). Resolved into the session JWT
// at login; changes take effect on the user's next login.
export const rolePermissions = pgTable(
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
export const users = pgTable("users", {
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

// customer_orders ------------------------------------------------------------
export const customerOrders = pgTable(
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
  ],
);

// order_line_items -----------------------------------------------------------
export const orderLineItems = pgTable(
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
export const workflowStages = pgTable("workflow_stages", {
  stageKey: varchar("stage_key", { length: 40 }).primaryKey(),
  label: varchar("label", { length: 60 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  // Days from the order's date to this stage's planned deadline (Settings →
  // Time tracking). planned_at = order_date 00:00 + planned_offset_days.
  plannedOffsetDays: integer("planned_offset_days").notNull().default(1),
});

// line_stage_progress --------------------------------------------------------
export const lineStageProgress = pgTable(
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
export const designDatabase = pgTable(
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
export const lookupValues = pgTable(
  "lookup_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: varchar("category", { length: 30 }).notNull(),
    value: varchar("value", { length: 200 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [index("idx_lookup_values_category").on(t.category)],
);

// Inferred row types for app use.
export type User = typeof users.$inferSelect;
export type CustomerOrder = typeof customerOrders.$inferSelect;
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type WorkflowStage = typeof workflowStages.$inferSelect;
export type LineStageProgress = typeof lineStageProgress.$inferSelect;
export type LookupValue = typeof lookupValues.$inferSelect;
export type DesignDatabaseRow = typeof designDatabase.$inferSelect;
