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
3. **Operations tracking is per LINE ITEM** through 7 stages — `order_entry`, `stock_checking`, `rolling_checking`, `challan`, `bill`, `dispatch`, `received_lr` — each with planned/actual datetime, done flag, delay (minutes). Stages complete **strictly in order** (a stage can only be marked done once the one before it is done); `stock_checking` is a 3-way gate (**Pending / In stock / Out of stock**) where only **In stock** unlocks the stages after it (§6).
4. **Fabric & design are free text with autocomplete.** This app has **no product catalog.** Party / sales / agent / haste / transport / fabric autocomplete come from `lookup_values`; design suggestions come from past line items (logged in `design_database`, §5).
5. **Operations status** (derived per line: COMPLETED / PARTIALLY COMPLETED / PENDING) is this app's status. **Inventory levels, demand, samples, procurement and fulfilment are NOT this app's concern** — that's the Embroidery System. The *only* stock concept here is the per-line **In stock / Out of stock gate** on the `stock_checking` stage — an operational checkpoint ("can this line proceed?"), **not** stock/inventory management.
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

### `workflow_stages`  (seed the 7 — also the Time-tracking / SLA config)
- `stage_key` VARCHAR(40) PK · `label` VARCHAR(60) NOT NULL · `sort_order` INT NOT NULL (1..7) · `planned_offset_days` INT NOT NULL DEFAULT 1 (**SLA**: days from `order_date` to this stage's planned deadline; edited in Settings → Time tracking) *(migration 0001)*

### `line_stage_progress`
- `id` UUID PK · `order_line_item_id` UUID FK → order_line_items (cascade) · `stage_key` FK → workflow_stages · `planned_at` TIMESTAMPTZ · `actual_at` TIMESTAMPTZ · `is_done` BOOL DEFAULT FALSE · `delay_minutes` INT · `stock_status` VARCHAR(20) (**only on the `stock_checking` row**: `in_stock` | `out_of_stock` | NULL — §6; *migration 0002*) · `updated_by` · `updated_at`
- **UNIQUE (`order_line_item_id`, `stage_key`)**; INDEX (`order_line_item_id`)

### `lookup_values`  (autocomplete sources — the Dropdown Master)
- `id` UUID PK · `category` VARCHAR(30) NOT NULL (PARTY|SALES_PERSON|AGENT|HASTE|TRANSPORT|FABRIC) · `value` VARCHAR(200) NOT NULL · `is_active` BOOL DEFAULT TRUE · INDEX (`category`)

### `design_database`  (log of every fabric+design used — powers design autocomplete + a browsable history)
- `id` UUID PK · `created_at` · `order_id` UUID FK → customer_orders (**ON DELETE SET NULL**) · `order_no` VARCHAR(50) NOT NULL (denormalized so it survives order deletion) · `fabric_name` VARCHAR(100) NOT NULL · `design_no` VARCHAR(100) NOT NULL
- **UNIQUE (`order_no`, `fabric_name`, `design_no`)**; INDEX (`fabric_name`); INDEX (`design_no`)

## 6. Business rules
- `order_no` unique; reject duplicates with a clear message.
- `line_total` is generated; order grand total derived (Σ line_total).
- On order save, **create the 7 `line_stage_progress` rows per line** (all `is_done=false`). Each stage's `planned_at` is **SLA-driven**: `order_date` 00:00 (UTC) + that stage's `planned_offset_days`. Planned dates are config-driven — completing a stage never rewrites any `planned_at`.
- **Stage completion + sequencing** (all in `lib/workflow.ts`, ONE transaction; a rule violation throws `WorkflowError` → the stage API returns **409** with the message):
  - **Fully sequential** — a stage can only be completed once the immediately-previous stage is done.
  - **`stock_checking` gate** — the chosen outcome is stored in `stock_status`: `in_stock` **completes** the stage (unlocking everything after it); `out_of_stock` records the block; `NULL` = undecided. Only `in_stock` counts as done; while `out_of_stock`/`NULL`, all later stages stay **locked**.
  - **Block downgrades** — a done stage can't be un-completed (nor `stock_checking` set to `out_of_stock`/pending) while a **later** stage is still done; clear the later stage first.
  - On complete: set `actual_at` (client value or now), `is_done=true`, `delay_minutes = round((actual − planned)/60000)`. Un-tick clears actual/done/delay. Recompute the line's operations status.
- **Bulk "check all"** (per stage column on the tracking board) is prerequisite-aware: it only marks lines whose previous stage is done and skips the rest (reporting how many were skipped).
- **Operations status** per line: all done → COMPLETED; some → PARTIALLY COMPLETED; none → PENDING. Order-level status = roll-up of its lines. (`out_of_stock` leaves the stage not-done, so such a line stays PARTIALLY/PENDING, never COMPLETED.)
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
- **Operations stage colours** (the per-stage dot in headers): order_entry indigo, stock_checking blue, rolling_checking amber, challan rose, bill emerald, dispatch violet, received_lr cyan.
- **Operations tracking — per-stage cell status colours** (tracking board; the cell tint *is* the status — planned/actual dates are hidden and shown on hover only):
  - **Done (on time)** → green, no pill (green alone means on-time)
  - **Done late** → amber, plus a `+Xm` delay pill
  - **Live** (the current stage to action = first not-done) → indigo/accent
  - **Overdue** (live *and* past its planned date) → red
  - **Out of stock** → red, labelled "Blocked"
  - **Locked** (later stage, previous not done) / **Pending** → grey
  Derived per line by `cellState()` in `tracking-board.tsx` (never stored); drives the cell border+tint+label.

## 10. Do / Don't
DO: read this first; keep stage logic in `workflow.ts`; treat order/fabric/design as text; ask before adding anything not listed.
DON'T: manage stock/vendors/procurement here; auto-number `order_no`; write `line_total`; block unknown fabric/design; call the Embroidery System.

## 11. Build order
- **OE-P0** — scaffold + Neon/Drizzle + schema + migration + seed (7 stages + sample lookups) + health check.
- **OE-P1** — auth + role middleware + app shell (sidebar: New Order, Orders, Operations).
- **OE-P2** — order entry form (rich) + Orders Dashboard.
- **OE-P3** — Operations tracking (7-stage workflow).
- **OE-P4** — secured export API for the Embroidery System.
- **OE-P5** — Settings / master data: Dropdown Master (lookup CRUD + bulk paste), Design Database, Time-tracking SLA (`planned_offset_days`), Users & access — all role-gated.
- **OE-P6** — Analytics dashboard + **Order Status** board (read-only, grouped by order, expandable rows, CSV export) + `status-drawer`.
- **OE-P7** — Mobile-responsive shell (slide-in nav drawer) + operations-workflow rework: `stock_checking` in/out gate, fully-sequential locking, block-on-downgrade, prerequisite-aware bulk check, and a compact/colour-coded tracking grid.

---

## Implementation notes (living)
- **Next.js pinned to 15.x** per §2 (project uses `create-next-app@15` → Next 15.5.x, React 19, Tailwind v4, eslint-config-next 15). `create-next-app@latest` now defaults to Next 16; we deliberately stay on 15 to honor the lock.
- Migrations live in `db/migrations/`; the initial migration is `0000_init` (drizzle-kit numbers migrations 0-based and zero-padded per §8 — its next-migration index is derived from the journal entry count, so renaming to `0001` would collide with OE-P1's migration). Apply with `npm run db:migrate`; seed with `npm run db:seed` (both load `.env.local`).
- Standalone scripts (seed, drizzle-kit) load env via `db/load-env.ts` / config, since Next's automatic `.env.local` loading does not apply outside the Next runtime.
- **Migrations to date:** `0000_init` (P0) · `0001` (adds `workflow_stages.planned_offset_days`, the SLA) · `0002` (adds `line_stage_progress.stock_status`; written `ADD COLUMN IF NOT EXISTS`, so re-running is a safe no-op). Applied to Neon manually (§8). **A new column/migration must also be applied to the production DB before/when the code that reads it deploys** — otherwise prod queries error (`column … does not exist`).
- **Operations-workflow rules** live only in `lib/workflow.ts` (`applyStageProgress` + `WorkflowError`; §6). Reads: `GET /api/orders/:id/tracking`; writes: `PATCH /api/tracking/stage` (maps `WorkflowError` → 409). The tracking board (`components/tracking/tracking-board.tsx`) mirrors the rules: per row, only the **live** (first not-done) and **last-done** cells are editable — everything else is locked; `stock_checking` renders the Pending/In stock/Out of stock control.
- **Order Status** module (`components/order-status/*`, `lib/order-status.ts`, `app/api/order-status`): read-only board grouped **by order** — one expandable row per order; an order-level stage shows *done* only when ALL its lines finished it, else a partial `n/m`, `overdue`, or `–`. Grouping/aggregation is client-side (`aggregateOrderGroups`); the per-line detail drawer (`status-drawer.tsx`) and CSV export stay line-level.
- **Orders dashboard** (`components/orders/orders-dashboard.tsx`) columns: **Designs** (= `line_count`), **Total Qty**, **Haste**, **Agent** (`haste`/`agent` were added to the `/api/orders` row + `OrderRow` type); bold black headers, single-line rows.
- **Tracking board** (`components/tracking/tracking-board.tsx`): the 7-stage grid, one row per line. **Design** is split out of Quality; order-level **Designs / Lot no / Challan / Haste** are shown as columns. Each stage cell is **compact and colour-coded by status** (§9) — planned/actual dates are hidden and surfaced on hover (cell `title`); only *late* stages show a `+Xm` pill (green = done on-time, no pill). Non-stock stages use a checkbox; `stock_checking` a Pending / In stock / Out of stock dropdown; the header keeps a per-column, prerequisite-aware "mark all". A **colour legend** strip above the grid (visible to all roles) decodes the statuses for new users. *(A collapse-to-pipeline + expand-to-edit variant was tried and reverted — keeping the visible 7-column grid is intentional.)*
- **Mobile:** every screen is responsive; a slide-in nav drawer (`components/app-shell/mobile-nav.tsx`) replaces the desktop sidebar below `md` (desktop md+ preserved exactly). `app/layout.tsx` exports `viewport`.
- **Shared table primitives** live in `components/ui/table.tsx` (`Th`, …) — reuse for new tables.
- **Design tokens:** the *implemented* palette (neutral canvas + indigo accent, light **and** dark) is in `app/globals.css` (CSS variables + Tailwind v4 `@theme`); §9 records design intent. Use semantic tokens — `text-ink`/`ink-soft`/`ink-muted`, `bg-surface`/`surface-2`/`inset`, `border-line`/`line-strong`, `success`/`warning`/`danger`, `.num` (tabular mono). Prefer `text-ink` over literal `black` so dark mode still works.
- **Exports:** `/api/export/orders` is JSON (§7); the Order-Status "Export" builds CSV client-side. SheetJS/`xlsx` (§2) is reserved for future spreadsheet export, not yet wired.
- **Local env:** `.env.local` (gitignored) holds `DATABASE_URL` (a Neon dev branch), `AUTH_SECRET`, `EXPORT_API_KEY`, `NEXT_PUBLIC_APP_VERSION`; Vercel production keeps its own env. `db:seed` seeds the 7 stages, sample lookups, and one ADMIN — real dropdown values are managed in Settings → Dropdown Master.
