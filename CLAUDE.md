# CLAUDE.md — Order Entry System

> **Project constitution.** Read this before every task and follow it exactly. Never introduce a pattern, library, or table not described here. If anything is ambiguous, STOP and ask.

> This is **one of two separate apps.** This app owns **orders + operations tracking**. A second app — the **Embroidery System** (separate repo, separate DB) — *pulls* order data from here read-only to run stock/demand. **This app never manages stock, vendors, or procurement, and never calls the Embroidery System.**

---

## 1. What this is
Standalone **order-entry & operations-tracking** ERP for a fabric / embroidery house. It is the **system of record for customer orders** and their **7-stage TAT (turnaround) tracking**. It exposes a secured read API that the Embroidery System consumes.

**Roles:** `ADMIN` · `SALES` (enter / edit orders) · `OPS` (update tracking stages) · `VIEWER` (read-only).

## 2. Tech stack — LOCKED
Next.js 15 (App Router, TS strict) · Neon (`@neondatabase/serverless`) · Drizzle + drizzle-kit · NextAuth/Auth.js v5 (email+password, roles) · Tailwind + shadcn/ui · TanStack Query · SheetJS (`xlsx`) · Vercel.
Not allowed: Supabase, Prisma, any second UI kit, raw `pg` in app code.

## 3. Locked decisions
1. **`order_no` is TEXT, user-entered, UNIQUE** (e.g. `LKD-08-25-003`); validate duplicates on entry; never auto-number.
2. **Orders = one header + fabric blocks → many line items**, with pricing: `rate` per fabric, generated `line_total = qty_mtr * rate`; order grand total is **derived**, never stored.
3. **Operations tracking is per LINE ITEM** through 7 stages — `order_entry`, `stock_checking`, `rolling_checking`, `challan`, `bill`, `dispatch`, `received_lr` — each with planned/actual datetime, done flag, delay (minutes).
4. **Fabric & design are free text with autocomplete.** This app has **no product catalog.** Party / sales / agent / haste / transport / fabric autocomplete come from `lookup_values`; design suggestions come from past line items.
5. **Operations status** (derived per line: COMPLETED / PARTIALLY COMPLETED / PENDING) is this app's status. **Stock, demand, samples, and fulfilment are NOT this app's concern** — that's the Embroidery System.
6. **Exposes a secured read API** (`/api/export/orders`, §7) for the Embroidery System to pull orders incrementally. This app is the source; it never pulls from Embroidery.

## 4. Folder structure
```
order-entry-system/
  app/
    api/            # route handlers (JSON), incl. api/export/orders
    (auth)/
    orders/         # entry form + orders dashboard
    tracking/       # operations workflow view
  components/
  lib/ db.ts · auth.ts · workflow.ts (stage logic)
  db/ schema.ts · migrations/ · seed.ts
```

## 5. Database schema — CANONICAL
UUID PKs (`gen_random_uuid()`); `TIMESTAMPTZ DEFAULT now()`; quantities `DECIMAL(10,2)`. **`order_no`, `quality`, `design_no`, `challan_no`, `lot_no` are ALWAYS text.**

### `users`
- `id` UUID PK · `email` UNIQUE NOT NULL · `password_hash` · `name` · `role` (ADMIN|SALES|OPS|VIEWER, default VIEWER) · `is_active` BOOL DEFAULT TRUE · `created_at`

### `customer_orders`
- `id` UUID PK · `order_no` VARCHAR(50) UNIQUE NOT NULL · `order_date` DATE NOT NULL · `party_name` VARCHAR(200) NOT NULL · `sales_person` VARCHAR(100) · `agent` VARCHAR(120) · `haste` VARCHAR(120) · `transport` VARCHAR(120) · `challan_no` VARCHAR(100) · `lot_no` VARCHAR(100) · `department` VARCHAR(40) DEFAULT 'LD' · `remarks` TEXT · `created_by` VARCHAR(120) · `created_at`, `updated_at`
- INDEX (`party_name`); INDEX (`order_date`)

### `order_line_items`
- `id` UUID PK · `order_id` UUID FK → customer_orders (cascade) · `quality` VARCHAR(100) NOT NULL (the fabric) · `design_no` VARCHAR(100) NOT NULL · `qty_mtr` DECIMAL(10,2) NOT NULL · `rate` DECIMAL(10,2) · `line_total` DECIMAL(12,2) GENERATED ALWAYS AS (`qty_mtr` * `rate`) STORED (**never write directly**) · `is_cancelled` BOOL DEFAULT FALSE · `remarks` TEXT · `created_at`, `updated_at`
- INDEX (`order_id`); INDEX (`quality`, `design_no`)

### `workflow_stages`  (seed the 7)
- `stage_key` VARCHAR(40) PK · `label` VARCHAR(60) NOT NULL · `sort_order` INT NOT NULL (1..7)

### `line_stage_progress`
- `id` UUID PK · `order_line_item_id` UUID FK → order_line_items (cascade) · `stage_key` FK → workflow_stages · `planned_at` TIMESTAMPTZ · `actual_at` TIMESTAMPTZ · `is_done` BOOL DEFAULT FALSE · `delay_minutes` INT · `updated_by` · `updated_at`
- **UNIQUE (`order_line_item_id`, `stage_key`)**; INDEX (`order_line_item_id`)

### `lookup_values`  (autocomplete sources)
- `id` UUID PK · `category` VARCHAR(30) NOT NULL (PARTY|SALES_PERSON|AGENT|HASTE|TRANSPORT|FABRIC) · `value` VARCHAR(200) NOT NULL · `is_active` BOOL DEFAULT TRUE · INDEX (`category`)

## 6. Business rules
- `order_no` unique; reject duplicates with a clear message.
- `line_total` is generated; order grand total derived (Σ line_total).
- On order save, **create the 7 `line_stage_progress` rows per line** (all `is_done=false`); `order_entry.planned_at` = creation time.
- **Stage completion** (in `lib/workflow.ts`): set `actual_at` (client value or now), `is_done=true`, `delay_minutes = MAX(0, round((actual − planned)/60000))`; if the next stage's `planned_at` is empty, set it to this `actual_at`. Un-tick clears actual/done/delay. Recompute the line's operations status. One transaction.
- **Operations status** per line: all done → COMPLETED; some → PARTIALLY COMPLETED; none → PENDING. Order-level status = roll-up of its lines.
- **Edit an order:** replace its line items, but **preserve `line_stage_progress`** for lines that still match on (fabric + design + qty); create fresh stage rows only for genuinely new lines.

## 7. Export API (consumed by the Embroidery System)
- `GET /api/export/orders` — auth via a static API key in a request header (`x-api-key`, stored in env). Read-only.
- Query: `updated_since` (ISO timestamp) for incremental sync; pagination.
- Returns each order with header fields and its line items, each carrying **stable ids** (`order.id`, `line.id`) so Embroidery can dedupe (these become Embroidery's `external_ref`): `order_no`, `order_date`, `party_name`, `sales_person`, `department`, and per line `quality`, `design_no`, `qty_mtr`, `is_cancelled`, plus the line's operations status. **No pricing is exported** unless asked.

## 8. Conventions
- API under `/app/api`, JSON, auth on every route (after P1; the export route uses the API key). Error `{ error }`, success `{ data }`.
- Operations-stage logic only in `lib/workflow.ts`. DB only via Drizzle through `lib/db.ts`. No raw SQL except migrations.
- `order_no` / `quality` / `design_no` always text — never `parseInt`/`Number()`.
- Fabric/design free text with autocomplete; never block an unknown value.
- `line_total` generated — never write it; never store the grand total.
- Migrations: drizzle-kit, zero-padded sequential, applied to Neon manually.
- UI: sentence case; tables primary; design tokens §9.

## 9. Design tokens
- `--primary` `#4F46E5` · `--primary-dark` `#4338CA` · `--success` `#16A34A` · `--warning` `#CA8A04` · `--danger` `#DC2626` · `--bg-light` `#F8FAFC` · `--border` `#E2E8F0`. Sidebar `#1E293B` (260px). Header indigo `#4F46E5→#6366F1` (64px).
- **Operations stage colours:** order_entry indigo, stock_checking blue, rolling_checking amber, challan rose, bill emerald, dispatch violet, received_lr cyan.

## 10. Do / Don't
DO: read this first; keep stage logic in `workflow.ts`; treat order/fabric/design as text; ask before adding anything not listed.
DON'T: manage stock/vendors/procurement here; auto-number `order_no`; write `line_total`; block unknown fabric/design; call the Embroidery System.

## 11. Build order
- **OE-P0** — scaffold + Neon/Drizzle + schema + migration + seed (7 stages + sample lookups) + health check.
- **OE-P1** — auth + role middleware + app shell (sidebar: New Order, Orders, Operations).
- **OE-P2** — order entry form (rich) + Orders Dashboard.
- **OE-P3** — Operations tracking (7-stage workflow).
- **OE-P4** — secured export API for the Embroidery System.

---

## Implementation notes (living)
- **Next.js pinned to 15.x** per §2 (project uses `create-next-app@15` → Next 15.5.x, React 19, Tailwind v4, eslint-config-next 15). `create-next-app@latest` now defaults to Next 16; we deliberately stay on 15 to honor the lock.
- Migrations live in `db/migrations/`; the initial migration is `0000_init` (drizzle-kit numbers migrations 0-based and zero-padded per §8 — its next-migration index is derived from the journal entry count, so renaming to `0001` would collide with OE-P1's migration). Apply with `npm run db:migrate`; seed with `npm run db:seed` (both load `.env.local`).
- Standalone scripts (seed, drizzle-kit) load env via `db/load-env.ts` / config, since Next's automatic `.env.local` loading does not apply outside the Next runtime.
