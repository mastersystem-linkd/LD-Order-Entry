# PROJECTFLOW.md — LD Order Entry System

> A complete walkthrough of what this system is, what it is built from, how every
> piece connects, and what happens step by step when someone uses it.
>
> `CLAUDE.md` is the project **constitution** (the rules you must not break).
> This file is the project **explanation** (how it actually works, end to end).

---

## Table of contents

1. [What this system is](#1-what-this-system-is)
2. [The two-app landscape](#2-the-two-app-landscape)
3. [Technology stack — languages, frameworks, libraries](#3-technology-stack--languages-frameworks-libraries)
4. [Repository layout](#4-repository-layout)
5. [Runtime architecture](#5-runtime-architecture)
6. [The database](#6-the-database)
7. [The three lifecycle states of a design line](#7-the-three-lifecycle-states-of-a-design-line)
8. [Authentication flow](#8-authentication-flow)
9. [Authorization — roles, capabilities, three enforcement layers](#9-authorization--roles-capabilities-three-enforcement-layers)
10. [Module-by-module functional flow](#10-module-by-module-functional-flow)
11. [The 7-stage operations workflow in depth](#11-the-7-stage-operations-workflow-in-depth)
12. [Derived values — nothing redundant is stored](#12-derived-values--nothing-redundant-is-stored)
13. [Complete API reference](#13-complete-api-reference)
14. [The export API (Embroidery System integration)](#14-the-export-api-embroidery-system-integration)
15. [Client-side data flow and state](#15-client-side-data-flow-and-state)
16. [Design system](#16-design-system)
17. [Database access patterns](#17-database-access-patterns)
18. [Migrations — history and the manual-apply rule](#18-migrations--history-and-the-manual-apply-rule)
19. [Environment variables](#19-environment-variables)
20. [Local development workflow](#20-local-development-workflow)
21. [Build and deployment](#21-build-and-deployment)
22. [Verification scripts](#22-verification-scripts)
23. [Known constraints and gotchas](#23-known-constraints-and-gotchas)
24. [Glossary](#24-glossary)
25. [The Neon → Supabase migration (2026-08-18)](#25-the-neon--supabase-migration-2026-08-18)

---

## 1. What this system is

The LD Order Entry System is a standalone **order-entry and operations-tracking
ERP** built for a fabric and embroidery house (LD Silk Mills). It is the
**system of record for customer orders**.

Two things happen in this app and nowhere else:

1. **Order capture.** A salesperson records a customer order: one header (order
   number, date, party, agent, transport, challan, lot…) with one or more
   **fabric blocks**, each containing one or more **design line items** with a
   quantity in metres and a rate.
2. **Operations tracking.** Every design line item then travels through a fixed
   **7-stage turnaround (TAT) workflow**, tracked individually with planned
   deadlines, actual completion times and delay measurement.

It additionally exposes a **secured read-only API** so a separate Embroidery
System can pull order data for its own stock and demand planning.

**Modules visible in the sidebar:** Dashboard (analytics) · New order · Orders ·
Order status · Operations · Trash · Settings.

### What this system deliberately does NOT do

- No inventory or stock management (that belongs to the Embroidery System).
- No vendors, procurement, or purchasing.
- No product catalogue — fabric and design names are free text with
  autocomplete, never a constrained master list.
- No auto-numbering of order numbers — they are user-entered and unique.
- It never calls the Embroidery System. Data flows one way: Embroidery pulls
  from here.

The single stock-related concept in this app is a per-line **In stock /
Out of stock gate** on one workflow stage. That is an operational checkpoint
("can this line proceed?"), not inventory management.

---

## 2. The two-app landscape

```
   ┌──────────────────────────────┐                  ┌──────────────────────────────┐
   │   LD ORDER ENTRY (this app)  │                  │   EMBROIDERY SYSTEM          │
   │                              │                  │   (separate repo + DB)       │
   │  • customer orders           │   GET /api/      │                              │
   │  • design line items         │   export/orders  │  • stock levels              │
   │  • 7-stage TAT tracking      │ ───────────────▶ │  • demand / samples          │
   │  • users, roles, access      │   x-api-key      │  • procurement, fulfilment   │
   │                              │   (pull, one-way)│                              │
   │  SOURCE OF TRUTH for orders  │                  │  consumes order data         │
   └──────────────────────────────┘                  └──────────────────────────────┘
```

- Separate repositories, separate databases, separate deployments.
- Integration is a **pull**: the Embroidery System calls this app's export
  endpoint on a schedule with an `updated_since` timestamp.
- The stable UUIDs this app emits (`order.id`, `line.id`) become the Embroidery
  System's `external_ref`, so it can dedupe and update in place.
- **No pricing ever crosses the boundary.**

---

## 3. Technology stack — languages, frameworks, libraries

### Languages

| Language | Where it is used |
|---|---|
| **TypeScript** (strict mode) | Every line of application code — pages, components, API route handlers, business logic, database schema, scripts. There is no plain JavaScript in `app/`, `lib/`, `components/`, or `db/`. |
| **TSX / JSX** | React component markup. |
| **SQL (PostgreSQL dialect)** | Only inside `db/migrations/*.sql`. Application code never writes raw SQL — it goes through Drizzle, with the narrow exception of a few tagged `sql` fragments for aggregate expressions such as `count(*) filter (where …)`. |
| **CSS** | A single file, `app/globals.css`, holding the Tailwind v4 theme and the design tokens. |
| **JSON** | Config (`package.json`, `tsconfig.json`, `components.json`) and drizzle-kit migration snapshots. |

### Framework and runtime

| Technology | Version | Role |
|---|---|---|
| **Next.js** | 15.5.19 (App Router) | The whole application — server components, client components, API route handlers, edge middleware. Built with **Turbopack**. |
| **React** | 19.1.0 | UI library. Server Components by default; `"use client"` only where interactivity is needed. |
| **Node.js** | 20+ | Server runtime for API routes and server components. |
| **Edge runtime** | — | Runs `middleware.ts` only. This is why the auth config is split in two (see §8). |

### Data layer

| Technology | Role |
|---|---|
| **Supabase Postgres** (17.6) | The database, in project *LD Silk Mills* (ap-south-1). All tables live in the **`ld_order_entry`** schema, not `public`. |
| **postgres.js** (`postgres` ^3.4) | The driver. One client serves both reads and interactive transactions. |
| **Drizzle ORM** ^0.45.2 | Type-safe SQL query builder. The schema in `db/schema.ts` is the single source of truth and generates the TypeScript row types. |
| **drizzle-kit** ^0.31.10 | Migration generation, snapshots, and Drizzle Studio. |


### Auth and validation

| Technology | Role |
|---|---|
| **NextAuth / Auth.js v5** (beta.31) | Sessions. Two providers: Credentials (email + bcrypt password) and Google OAuth. **JWT strategy, no database adapter.** |
| **bcryptjs** ^3.0.3 | Password hashing (cost factor 10). |
| **zod** ^4.4.3 | Every write payload is parsed by a zod schema in `lib/validation.ts` before it reaches the database. |

### UI

| Technology | Role |
|---|---|
| **Tailwind CSS v4** | Styling, via `@tailwindcss/postcss`. Theme defined with `@theme inline` in `globals.css`, not a JS config file. |
| **shadcn/ui on base-ui** (`@base-ui/react` ^1.6.0) | The component primitives in `components/ui/`. One UI kit only — a second is explicitly forbidden. |
| **lucide-react** ^1.22.0 | Icon set. |
| **Recharts** ^3.9.0 | Dashboard charts (trend area chart, status donut). Simpler visuals — pipeline bars, the radial gauge — are hand-written SVG. |
| **next-themes** ^0.4.6 | Light/dark switching, writing `data-theme` on `<html>`. |
| **sonner** ^2.0.7 | Toast notifications. |
| **framer-motion** ^12.42.0 | Reveal/entrance animations (`components/ui/reveal.tsx`). |
| **@number-flow/react** | Animated numeric counters on KPI tiles. |
| **react-parallax-tilt** | Login-page brand panel effect. |
| **clsx** + **tailwind-merge** | The `cn()` class helper in `lib/utils.ts`. |
| **class-variance-authority** | Component variant definitions (button, badge). |
| **tw-animate-css** | Animation utilities. |

### Fonts (self-hosted, in `app/fonts/`)

- **Clash Display** (500/600) — display face for page titles and the grand-total figure. `--font-display`
- **General Sans** (400/500/600) — the UI/body face. `--font-ui`
- **JetBrains Mono** (from Google Fonts) — tabular figures, applied through the `.num` utility. `--font-mono`

### Client data fetching

- **TanStack Query v5** ^5.101.2 — every client-side read and mutation. Cache
  configured once in `app/providers.tsx`: `staleTime` 60s, `gcTime` 5min,
  no refetch on focus or reconnect, one retry.

### Tooling

ESLint 9 + `eslint-config-next` · `tsx` (running TypeScript scripts directly) ·
`dotenv` (env loading for standalone scripts) · TypeScript 5.

### Reserved but not yet wired

**SheetJS (`xlsx`)** is listed in the locked stack for future Excel export. All
current exports are CSV, generated client-side by `lib/csv.ts`.

### Explicitly forbidden

Neon · Prisma · any second UI kit · raw `pg` in application code.

---

## 4. Repository layout

```
LD-Order-Entry/
├── app/
│   ├── layout.tsx              Root layout: fonts, metadata, Mesh background, Providers, Toaster
│   ├── providers.tsx           ThemeProvider (next-themes) + QueryClientProvider (TanStack)
│   ├── globals.css             Tailwind v4 theme + all design tokens (light & dark)
│   ├── fonts/                  Self-hosted woff2 files + fonts.ts
│   │
│   ├── (auth)/login/           Public login route group
│   │   ├── page.tsx            Server component: session redirect, safe callbackUrl, googleEnabled
│   │   ├── login-form.tsx      Client: credentials + Google, password reveal, forgot-password hint
│   │   └── login-theme-toggle.tsx
│   │
│   ├── (app)/                  Authenticated route group — wrapped by the AppShell
│   │   ├── layout.tsx          Re-checks the session, resolves role+caps, renders AppShell
│   │   ├── actions.ts          Server action: signOutAction
│   │   ├── page.tsx            Dashboard (analytics)
│   │   ├── orders/             page.tsx (list) · new/ · [id]/ · [id]/edit/
│   │   ├── order-status/       page.tsx (read-only board, wrapped in Suspense)
│   │   ├── tracking/           page.tsx (index) · [id]/ (the 7-stage board)
│   │   ├── trash/              page.tsx
│   │   └── settings/           page.tsx (ADMIN-only, re-checked server-side)
│   │
│   └── api/                    JSON route handlers — see §13
│
├── components/
│   ├── app-shell/              sidebar · mobile-nav · header · footer · theme-toggle · mesh · app-shell
│   ├── orders/                 order-form · orders-dashboard · order-detail · order-designs ·
│   │                           order-filters · use-lookups
│   ├── order-status/           order-status-board · status-drawer · column-picker
│   ├── tracking/               tracking-index · tracking-board
│   ├── dashboard/              dashboard-view · dashboard-charts
│   ├── trash/                  trash-view
│   ├── settings/               settings-view · dropdown-master · design-db · time-tracking ·
│   │                           users-manage · access-control
│   └── ui/                     button · card · input · label · dialog · badge · status-badge ·
│                               table · spinner · autocomplete · stat-card · sonner · reveal
│
├── lib/
│   ├── db.ts                   The ONLY database connection point — exports `db` and `dbx`
│   ├── auth.ts                 Full Auth.js instance (Node runtime): providers, callbacks, caps
│   ├── auth.config.ts          Edge-safe Auth.js config (no DB, no bcrypt) — used by middleware
│   ├── rbac.ts                 Roles, capabilities, defaults, nav items, canAccessPath
│   ├── api.ts                  Route guards + { data } / { error } envelopes
│   ├── api-client.ts           Client fetch helpers that unwrap the envelope
│   ├── workflow.ts             ALL stage logic + status derivations (single source)
│   ├── validation.ts           Every zod schema for write payloads
│   ├── orders.ts               Client-facing order/trash types
│   ├── order-status.ts         Order Status types + per-stage state derivation
│   ├── dashboard.ts            Dashboard payload type + date-range presets
│   ├── csv.ts                  Client-side CSV building and download
│   ├── email.ts                normalizeEmail — applied on every read and write path
│   ├── utils.ts                cn()
│   ├── use-debounced-value.ts
│   └── use-reduced-motion.ts
│
├── db/
│   ├── schema.ts               CANONICAL schema — tables, enums, indexes, inferred types
│   ├── seed.ts                 Idempotent seed: 7 stages, lookups, one ADMIN, access matrix
│   ├── load-env.ts             Loads .env.local for standalone scripts
│   └── migrations/             0000–0006 SQL + meta/ snapshots + _journal.json
│
├── types/next-auth.d.ts        Augments Session/User/JWT with role + caps
├── middleware.ts               Edge auth gate + canAccessPath
├── next.config.ts              serverExternalPackages for the Neon ws fix
├── drizzle.config.ts
├── verify-*.ts                 Standalone end-to-end check scripts
├── CLAUDE.md                   Project constitution
└── PROJECTFLOW.md              This document
```

---

## 5. Runtime architecture

### Rendering model

Next.js App Router with **React Server Components by default**. The split is
deliberate:

- **Server components** (`app/(app)/**/page.tsx`, `layout.tsx`) read the session
  with `auth()`, redirect when necessary, and pass `role` and `caps` down as
  plain props. They render no interactive state.
- **Client components** (everything in `components/` that starts with
  `"use client"`) own interactivity and fetch their data from the JSON API
  through TanStack Query.

This means page loads are cheap and authorization decisions happen on the server
before any HTML is produced, while the heavy interactive surfaces (the tracking
board, the orders dashboard) behave like a SPA once loaded.

### Request lifecycle — a page

```
Browser request  /orders
      │
      ▼
[EDGE] middleware.ts
      │  • Reads the session JWT via auth.config.ts (no DB — edge cannot use bcrypt/Neon)
      │  • No session?  → redirect /login?callbackUrl=/orders   (API → 401 JSON)
      │  • canAccessPath(role, caps, "/orders") false? → redirect "/"   (API → 403 JSON)
      ▼
[NODE] app/(app)/layout.tsx  (server component)
      │  • auth() again — defence in depth; never render the shell without a session
      │  • Resolves role + caps, renders <AppShell> (sidebar filtered by visibleNav)
      ▼
[NODE] app/(app)/orders/page.tsx  (server component)
      │  • Renders the client <OrdersDashboard caps={…} />
      ▼
[BROWSER] OrdersDashboard mounts
      │  • TanStack Query → GET /api/orders?…
      ▼
[NODE] app/api/orders/route.ts
      │  • requireAnyCapability(["orders.view","operations.view"])
      │  • Drizzle queries against Neon
      │  • Returns { data: { orders, page, total, summary } }
      ▼
[BROWSER] Renders the table; cache holds it for 60s
```

### Request lifecycle — a write

```
User ticks a stage cell
      │
      ▼ optimistic UI update (TanStack onMutate)
PATCH /api/tracking/stage   { line_item_id, stage_key, checked, stock_status, actual }
      │
      ▼
[EDGE] middleware — session present? yes → pass
      ▼
[NODE] route handler
      │  1. requireCapability("operations.edit")            → 401 / 403
      │  2. stageToggleSchema.safeParse(body)               → 422 + first zod message
      │  3. Line exists? not deleted? not cancelled?        → 404 / 409
      │  4. applyStageProgress(...) in lib/workflow.ts
      │        └─ dbx.transaction:
      │              read all 7 stage rows for the line
      │              enforce gating rules → WorkflowError
      │              write actual_at / is_done / delay_minutes / stock_status
      │              re-read and recompute the line status
      │  5. WorkflowError → 409 with the human message; anything else → 500
      ▼
{ data: { line_item_id, stage_key, checked, stock_status, line_status } }
      │
      ▼ on error the optimistic update is rolled back and a toast shows the message
```

### The two runtimes and why auth is split

The middleware runs on the **Edge runtime**, which cannot use bcrypt or the Neon
driver. So the Auth.js configuration is split:

- `lib/auth.config.ts` — **edge-safe**. No DB, no bcrypt, empty `providers` array.
  It only defines the JWT/session callbacks that read what is already on the
  token. `middleware.ts` builds its NextAuth instance from this.
- `lib/auth.ts` — **Node runtime**. Spreads `authConfig`, then adds the
  Credentials and Google providers and the callbacks that hit the database.
  Used by the NextAuth route handler, server components, and API guards.

Because capabilities are baked into the JWT at sign-in, the edge middleware can
make full authorization decisions with **zero database round trips**.

---

## 6. The database

Supabase PostgreSQL 17.6, project *LD Silk Mills*. **Every table lives in the `ld_order_entry` schema**, never `public` — the project is shared with other apps, and Supabase's Data API publishes only `public`, so order data is unreachable through it. Conventions used throughout:

- UUID primary keys via `gen_random_uuid()` (`uuid().primaryKey().defaultRandom()`)
- `TIMESTAMPTZ DEFAULT now()` for timestamps
- Quantities as `DECIMAL(10,2)`
- **`order_no`, `quality`, `design_no`, `challan_no`, `lot_no` are ALWAYS text.**
  Never `parseInt`, never `Number()`. Order numbers look like `LKD-08-25-003`.

### Entity relationships

```
                    users                      workflow_stages
                      │                          (7 rows, seeded)
                      │                              │  stage_key PK
              role_permissions                       │
             (role × capability)                     │
                                                     │
   customer_orders ──1:N──▶ order_line_items ──1:N──▶ line_stage_progress
        │  (cascade delete)      │  (cascade delete)   (7 rows per line,
        │                        │                      unique per line+stage)
        │                        └── is_cancelled, is_deleted
        │
        └──1:N (ON DELETE SET NULL)──▶ design_database

   lookup_values   (standalone — autocomplete source, the "Dropdown Master")
```

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `email` | UNIQUE NOT NULL | always stored lowercase+trimmed via `normalizeEmail` |
| `password_hash` | TEXT **nullable** | null for Google-only accounts |
| `name` | VARCHAR(200) | |
| `role` | `user_role` enum | `ADMIN` \| `SALES` \| `OPS` \| `VIEWER`, default `VIEWER` |
| `is_active` | BOOL default TRUE | inactive users cannot sign in by either provider |
| `created_at` | TIMESTAMPTZ | |

> The enum previously contained `MANAGER` (added in migration 0003). It was
> removed in **migration 0006** because its capability grants had become
> identical to ADMIN's, making it a duplicate access level.

### `role_permissions` — the admin-editable access matrix

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `role` | `user_role` | **ADMIN is never stored** — it is always full access |
| `capability` | VARCHAR(40) | `orders.view` \| `orders.edit` \| `operations.view` \| `operations.edit` |
| `allowed` | BOOL default FALSE | |
| `updated_at` | TIMESTAMPTZ | |

**UNIQUE (`role`, `capability`)** — the toggle endpoint upserts on this
constraint. Seeded from `DEFAULT_ROLE_CAPS` in `lib/rbac.ts`; a missing row
falls back to that code default, so the matrix is always complete even before
seeding. Added in migration 0004.

### `customer_orders`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | this id is the Embroidery System's `external_ref` |
| `order_no` | VARCHAR(50) **UNIQUE NOT NULL** | user-entered, never auto-numbered |
| `order_date` | DATE NOT NULL | the anchor for every SLA deadline |
| `party_name` | VARCHAR(200) NOT NULL | |
| `sales_person` | VARCHAR(100) | |
| `agent`, `haste`, `transport` | VARCHAR(120) | |
| `challan_no`, `lot_no` | VARCHAR(100) | text, always |
| `department` | VARCHAR(40) default `'LD'` | |
| `remarks` | TEXT | |
| `created_by` | VARCHAR(120) | the creating user's email/name |
| `created_at`, `updated_at` | TIMESTAMPTZ | `updated_at` drives incremental export |

Indexes: `party_name`, `order_date`.

**There is no `is_cancelled` or `is_deleted` on the header.** Order-level
cancelled and deleted are *derived* from the lines (see §12).

### `order_line_items` — the heart of the system

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | the Embroidery System's line-level `external_ref` |
| `order_id` | UUID FK → customer_orders | **ON DELETE CASCADE** |
| `quality` | VARCHAR(100) NOT NULL | this is the *fabric* |
| `design_no` | VARCHAR(100) NOT NULL | |
| `qty_mtr` | DECIMAL(10,2) NOT NULL | |
| `rate` | DECIMAL(10,2) | per fabric block |
| `line_total` | DECIMAL(12,2) **GENERATED ALWAYS AS (qty_mtr * rate) STORED** | **never written directly** |
| `is_cancelled` | BOOL default FALSE | customer cancelled — stays visible, struck through |
| `is_deleted` | BOOL NOT NULL default FALSE | entered in error — hidden, recoverable from Trash |
| `remarks` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMPTZ | `created_at` preserves the user's entry order |

Indexes: `order_id`; composite `(quality, design_no)`.

`is_cancelled` and `is_deleted` are **independent**. A line can be both — cancel
it, then delete it; restoring it from Trash brings it back still struck through.

### `workflow_stages` — the 7 stages and the SLA config

| Column | Type | Notes |
|---|---|---|
| `stage_key` | VARCHAR(40) **PK** | |
| `label` | VARCHAR(60) NOT NULL | |
| `sort_order` | INT NOT NULL | 1..7 |
| `planned_offset_days` | INT NOT NULL default 1 | **the SLA**: days from `order_date` to this stage's deadline. Edited in Settings → Time tracking. Added in migration 0001. |

Seeded rows:

| # | `stage_key` | Label | Default offset |
|---|---|---|---|
| 1 | `order_entry` | Order Entry | 1 day |
| 2 | `stock_checking` | Stock Checking | 1 day |
| 3 | `rolling_checking` | Rolling & Checking | 1 day |
| 4 | `challan` | Challan | 1 day |
| 5 | `bill` | Bill | 1 day |
| 6 | `dispatch` | Dispatch | 3 days |
| 7 | `received_lr` | Received LR | 4 days |

### `line_stage_progress` — one row per (line × stage)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `order_line_item_id` | UUID FK → order_line_items | **ON DELETE CASCADE** |
| `stage_key` | VARCHAR(40) FK → workflow_stages | |
| `planned_at` | TIMESTAMPTZ | `order_date` 00:00 UTC + `planned_offset_days` |
| `actual_at` | TIMESTAMPTZ | stamped on completion |
| `is_done` | BOOL default FALSE | |
| `delay_minutes` | INT | signed: positive = late |
| `stock_status` | VARCHAR(20) | **only meaningful on the `stock_checking` row**: `in_stock` \| `out_of_stock` \| NULL. Added in migration 0002. |
| `updated_by` | VARCHAR(120) | |
| `updated_at` | TIMESTAMPTZ | |

**UNIQUE (`order_line_item_id`, `stage_key`)**; index on `order_line_item_id`.

Creating an order with 3 fabric blocks × 4 designs each creates 12 line items
and **84** stage-progress rows, all in one transaction.

### `design_database` — the design autocomplete history

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `created_at` | TIMESTAMPTZ | |
| `order_id` | UUID FK → customer_orders | **ON DELETE SET NULL** |
| `order_no` | VARCHAR(50) NOT NULL | denormalized so it survives order deletion |
| `fabric_name` | VARCHAR(100) NOT NULL | |
| `design_no` | VARCHAR(100) NOT NULL | |

**UNIQUE (`order_no`, `fabric_name`, `design_no`)**; indexes on `fabric_name`
and `design_no`. Written with `onConflictDoNothing` on every order save, so
re-saving is idempotent. It is a persistent history — cancel and soft-delete do
not touch it.

### `lookup_values` — the Dropdown Master

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `category` | VARCHAR(30) NOT NULL | `PARTY` \| `SALES_PERSON` \| `AGENT` \| `HASTE` \| `TRANSPORT` \| `FABRIC` |
| `value` | VARCHAR(200) NOT NULL | |
| `is_active` | BOOL default TRUE | |

Index on `category`. The category list is a TypeScript const
(`LOOKUP_CATEGORIES`), not a DB enum — the column is plain VARCHAR per spec.

---

## 7. The three lifecycle states of a design line

Every design line item is in exactly one of three states. Understanding this is
the key to reading almost every query in the codebase.

| State | Flag | Visible? | In totals/status/tracking? | Reversible? |
|---|---|---|---|---|
| **Active** | neither flag | yes | yes | — |
| **Cancelled** | `is_cancelled = true` | **yes, struck through** | **no** | yes, immediately |
| **Deleted (trashed)** | `is_deleted = true` | **no — only in Trash** | no | yes, from Trash; can also be purged permanently |

The two rules that follow from this, applied everywhere:

> **Read paths filter `is_deleted = false`.**
> **Totals and status further filter `is_cancelled = false`.**

### Cancelled — "the customer cancelled it"

- Set with `PATCH /api/orders/:id/cancel` — `{ line_id, cancelled }` for one
  design, or `{ cancelled }` alone for the entire order.
- The line stays on screen with `text-ink-muted line-through`, so the record of
  what was ordered is never lost.
- It drops out of quantity, amount, operations status, and the tracking board.
- Stage progress is never deleted, so restoring a design brings back its prior
  tracking exactly.
- **Cancelled lines cannot be stage-edited** — the stage endpoint returns 409
  "This design is cancelled."
- A **fully cancelled** order still shows its (cancelled) lines' totals, so the
  struck-through row is not misleadingly ₹0.
- Whole-order cancel goes through a confirm dialog; restore is immediate.
  *Known limitation:* whole-order restore un-cancels **all** lines, because no
  per-line cancel scope is stored.

### Deleted — "this was entered by mistake"

- Set with `PATCH /api/orders/:id/delete` — same payload shape.
- Hidden from **every** normal read path: Orders list, order detail, edit form,
  Order status, Operations tracking, Dashboard analytics, and all counts.
- The Orders list uses an `EXISTS(non-deleted line)` filter so a fully-deleted
  order drops out of the result set *and* the pagination count — otherwise a
  page could render short.
- Surfaces only in **Trash**, which offers Restore and Delete permanently.
- **Permanent purge is guarded.** `DELETE /api/orders/:id` refuses unless the
  order is already fully soft-deleted; `DELETE /api/orders/:id/lines/:lineId`
  puts its `is_deleted` guard inside the DELETE's WHERE clause, so the check is
  atomic.
- The export API deliberately **emits** deleted lines with `is_deleted: true`
  rather than hiding them, so the Embroidery System can remove them on its side.
  Hiding them would leave a stale record downstream.

---

## 8. Authentication flow

Auth.js v5, **JWT session strategy, no database adapter**. Two providers.

### Credentials sign-in

```
login-form.tsx  ──signIn("credentials", {email, password})──▶  lib/auth.ts authorize()
                                                                    │
   1. zod-parse { email, password }                                 │
   2. normalizeEmail(email)  → lowercase + trim                     │
   3. SELECT user by email                                          │
   4. bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)   │
   5. reject unless: user exists AND is_active AND has a hash AND compare passed
                                                                    ▼
                                              returns { id, email, name, role }
```

Step 4 is a deliberate security measure: when no user matches, the comparison
still runs against a hard-coded dummy bcrypt hash, so every attempt costs the
same time. Without it, response latency would reveal which email addresses are
real accounts.

### Google sign-in

- The Google provider is only added to the providers array when **both**
  `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set. When they are absent the
  app runs normally and the login page hides the button.
- The `signIn` callback restricts Google to **existing active users**:

  ```
  if (provider !== "google") return true          // credentials already validated
  look up the normalized email in `users`
  return Boolean(dbUser?.isActive)                // no auto-provisioning, ever
  ```

  An administrator must create the account first (Settings → Users). This is
  the whole point — the app is role-gated, so a stranger with a Google account
  must never get in.

### The JWT callback — where capabilities are resolved

On sign-in the `jwt` callback:

1. Determines the user's `id` and `role` (looking them up by email for Google,
   or taking them from the `authorize()` return for credentials).
2. Calls `capsForRole(role)`:
   - `ADMIN` → all capabilities, unconditionally, without touching the DB.
   - Otherwise → read `role_permissions` rows for that role and keep the
     allowed ones.
   - If the role has **no stored rows** → fall back to `DEFAULT_ROLE_CAPS`.
   - If the query **throws** (e.g. the table does not exist yet because code
     shipped ahead of migration 0004) → also fall back to the code defaults, so
     logins never 500.
3. Stores `id`, `role`, and `caps` on the token.

The `session` callback then copies them onto `session.user`, with one more
safety net: a token issued before `caps` existed falls back to
`DEFAULT_ROLE_CAPS[role]`, so a deploy can never lock out already-signed-in
users.

**Consequence, and it matters operationally:** capabilities are resolved **once,
at sign-in**. Editing the Access matrix therefore takes effect on each affected
user's **next login**. The Access screen says so in its footer.

`types/next-auth.d.ts` augments the Auth.js `Session`, `User`, and `JWT`
interfaces so `session.user.role` and `session.user.caps` are strongly typed
everywhere.

---

## 9. Authorization — roles, capabilities, three enforcement layers

### Roles

| Role | Description |
|---|---|
| `ADMIN` | Always full access. Settings and user management are ADMIN-only and are **not** capabilities — they can never be granted to anyone else. |
| `SALES` | Configurable. |
| `OPS` | Configurable. |
| `VIEWER` | Configurable. |

### Capabilities

Only four, defined once in `lib/rbac.ts`:

| Key | Label | Covers |
|---|---|---|
| `orders.view` | View orders | Dashboard, orders list & detail, order status |
| `orders.edit` | Create / edit orders | New order, edit, cancel, soft-delete, Trash |
| `operations.view` | View operations | The 7-stage tracking board |
| `operations.edit` | Update operations | Mark stages done, set stock status |

### The Role × Capability matrix

Administrators toggle this in **Settings → Access**. `EDITABLE_ROLES` is
`["SALES", "OPS", "VIEWER"]` — ADMIN is rendered as a locked, always-checked
row so nobody can lock themselves out of Settings.

Code defaults (`DEFAULT_ROLE_CAPS`), which are the seed values and the fallback:

| Role | orders.view | orders.edit | operations.view | operations.edit |
|---|:---:|:---:|:---:|:---:|
| ADMIN | ✔ (locked) | ✔ (locked) | ✔ (locked) | ✔ (locked) |
| SALES | ✔ | ✔ | — | — |
| OPS | ✔ | — | ✔ | ✔ |
| VIEWER | ✔ | — | ✔ | — |

The **live** matrix is whatever is stored in `role_permissions`; these defaults
only apply where no row exists.

### Three enforcement layers

**1 · Edge middleware** — `middleware.ts` + `canAccessPath(role, caps, path)`

Runs before anything renders. Unauthenticated requests get a 401 (API) or a
redirect to `/login?callbackUrl=…` (page). Authenticated-but-unauthorized gets
403 (API) or a redirect to `/`, which every role can see, so nobody can be
redirect-looped out of the app.

`canAccessPath` in order:

```
ADMIN                                    → true, always
/settings…                               → false for everyone else
"/"                                      → true (the always-available landing)
/trash…                                  → orders.edit
/orders/new, /orders/:id/edit            → orders.edit    (most specific first)
/orders, /orders/:id, /order-status…     → orders.view
/tracking…                               → operations.view
anything else                            → true
```

The matcher excludes `api/auth`, `api/export`, `api/health`, `login`, Next
internals, and static files.

**2 · Route handlers** — `lib/api.ts`

- `requireRole([...])` — for ADMIN-only administrative endpoints.
- `requireCapability(cap)` — write endpoints. ADMIN always passes.
- `requireAnyCapability([...])` — read endpoints serving more than one screen
  (e.g. `/api/orders` feeds both the Orders list and the Operations index).

Each returns a discriminated union: `{ ok: true, user }` or
`{ ok: false, response }`, so every handler starts with the same two lines.

**3 · UI** — `hasCap(caps, cap)`

Pages pass `caps` into components, which hide buttons and columns the user
cannot use. `visibleNav(role, caps)` filters the sidebar. This layer is purely
cosmetic — it never carries security weight, since layers 1 and 2 already
enforce.

**Special case:** Trash is nested under Settings in `NAV_ITEMS` but is surfaced
as a top-level sidebar item for a non-admin who has `orders.edit` and therefore
cannot see Settings at all.

---

## 10. Module-by-module functional flow

### 10.1 Login

`app/(auth)/login/` — a split-screen design: a fixed dark brand panel on desktop
beside a theme-aware form panel.

- `page.tsx` (server) redirects if already signed in, sanitises `callbackUrl`,
  and computes `googleEnabled`.
- `login-form.tsx` (client) handles credentials, the Google button, a
  password show/hide toggle, and a "Forgot password?" link that reveals an
  admin-reset hint — there is no self-serve password reset by design.
- `login-theme-toggle.tsx` — a segmented Light/Dark control.

### 10.2 Dashboard (`/`)

`components/dashboard/dashboard-view.tsx` + `dashboard-charts.tsx`, fed by
`GET /api/dashboard`.

Filters: a date-range preset (Today / 7d / 30d / This month / Custom) and a
department filter (ALL / LD / LINKD).

**Every aggregate excludes cancelled AND soft-deleted lines**, and fully-deleted
orders via the `EXISTS(non-deleted line)` filter.

What it renders:

- **KPI row** (6 tiles, each deep-linking to a pre-filtered list): orders, value,
  metres, active orders, completed orders, overdue stages — plus a
  period-over-period comparison against the previous window.
- **Operations pipeline** — horizontal clickable bars, one per stage, linking to
  `/tracking?stage=…`.
- **Order trend** — a Recharts area chart with an orders/value toggle.
- **Status split** — a donut (Completed / Partially / Pending / Cancelled) with
  the total in the hole.
- **On-time delivery** — a radial gauge, green ≥ 90%, amber ≥ 70%, red below.
- **Cancellations & Trash** — cancelled designs and orders in range, plus the
  current Trash counts, linking to `/trash`.
- Top parties, top fabrics, recent orders, and a needs-attention list.

### 10.3 New order (`/orders/new`)

`components/orders/order-form.tsx` — at ~1,140 lines the single richest
component in the app.

Structure: a header section, then repeatable **fabric blocks**, each with a rate
and repeatable **design rows** (design number + quantity in metres).

Behaviours:

- **Autocomplete everywhere.** Party, sales person, agent, haste, transport and
  fabric come from `lookup_values` via `GET /api/lookups`; design suggestions
  come from `design_database` via `GET /api/designs?fabric=…`. Unknown values
  are always accepted — autocomplete never blocks entry.
- **Live duplicate check.** `GET /api/orders/check-no` validates the order
  number as it is typed.
- **Draft autosave.** In create mode the form persists to `localStorage` under
  `oe:new-order-draft:v1`, so a refresh or accidental navigation does not lose
  typed data.
- **Bulk add.** "Add N designs" inserts several design rows at once.
- Live grand total, computed client-side from qty × rate.

**What happens on submit** — `POST /api/orders`:

1. `requireCapability("orders.edit")`.
2. `orderPayloadSchema.safeParse` — a failure returns 422 with the first
   human-readable zod message.
3. Pre-check for a duplicate `order_no` → 409 with a clear message.
4. **One transaction** (`dbx.transaction`):
   - insert the `customer_orders` header, stamping `created_by`;
   - flatten fabric blocks × designs into `order_line_items` rows;
   - read the SLA offsets from `workflow_stages`;
   - insert **7 `line_stage_progress` rows per line**, each with
     `planned_at = order_date 00:00 UTC + planned_offset_days`, all
     `is_done = false`;
   - insert deduped `design_database` rows with `onConflictDoNothing`.
5. A race on the unique index still surfaces as a clean 409, because
   `isUniqueViolation` maps Postgres error code `23505`.
6. Returns `201 { id, order_no, line_count }`.

### 10.4 Orders list (`/orders`)

`components/orders/orders-dashboard.tsx` (~1,050 lines).

- The list **fetches the entire matching set** with `all=1` (capped at 5,000)
  and paginates client-side. This is what makes the five KPI cards accurate
  all-orders counts *and* one-click status filters: Total / Completed /
  In progress / Pending / Cancelled.
- Columns: Order no · Date · Party · Haste · Agent · Fabrics · Designs (active,
  with a `+N` cancelled hint) · Total Qty · Total Amount · Challan · Lot ·
  Status · Actions.
- Rows are **expandable** — a chevron opens `OrderDesignsPanel` on desktop
  (`OrderDesignsList` in the mobile popup) with per-design cancel and
  soft-delete, driven by the shared `useDesignActions` hook.
- The whole-order trash icon is a **soft** delete behind a confirm dialog.
- Filters: free-text search across order no / party / challan / lot, plus column
  filters for order no, challan, lot, haste, and an inclusive date range.
- CSV export is built client-side by `lib/csv.ts`, with a UTF-8 BOM so Excel
  renders Indian text and the ₹ symbol correctly.

Server-side, `GET /api/orders` returns per-order rolled-up quantity, grand
total, distinct fabrics, active/cancelled line counts, and a derived operations
status — plus an all-pages `summary` block for the cancellation KPI.

### 10.5 Order detail (`/orders/:id`) and edit (`/orders/:id/edit`)

`GET /api/orders/:id` returns the header, the line items with per-line status,
and **reconstructed fabric blocks** (lines grouped by fabric + rate) so the edit
form can be re-populated exactly as it was entered.

**The edit reconciliation** (`PUT /api/orders/:id`) is the most subtle piece of
logic in the app. A naive "delete all lines, insert new ones" would destroy
every stage tick. Instead:

1. Load existing **non-deleted** lines only — trashed lines must survive an edit
   untouched, since the form never showed them.
2. Bucket them by `lineMatchKey` = `fabric|design|qty`, normalised for case,
   whitespace, and numeric form (so `10` and `10.00` match).
3. For each submitted line, pop a matching bucket entry:
   - **matched** → keep the row and its stage progress; update the rate only if
     it actually changed;
   - **unmatched** → queue for insert.
4. Existing lines nobody matched are deleted (cascading their stage rows).
5. New lines get fresh stage rows seeded from the current SLA offsets.
6. **If the order date changed**, re-anchor every kept line's `planned_at` to
   the new date and recompute `delay_minutes` for already-completed stages.
   Without this, correcting a date would leave the order permanently "overdue"
   against its old deadline. `is_done`, `actual_at`, and `stock_status` are
   preserved.
7. Log any new (fabric, design) pairs to `design_database`.
8. Update the header and bump `updated_at`.

All of it in a single transaction.

### 10.6 Order status (`/order-status`)

`components/order-status/` — a **read-only** board grouped by order, with
`aggregateOrderGroups` doing the grouping client-side.

- Rows expand to show the individual design lines.
- Cancelled child rows are struck through; fully-cancelled parents are tagged
  "Cancelled".
- Per-stage cells show a coloured dot **always accompanied by a stage-name
  label**, because the seven stage hues are close together under colour
  blindness.
- At order level a stage counts as done only when **every** line has finished it;
  the cell also shows `doneOf / totalLines`, and for stock checking how many
  lines are out of stock.
- A **column picker** (`useColumnPrefs`, per-user `localStorage`) controls which
  columns are visible.
- KPI cards filter in place: Total / In progress / Completed / Overdue /
  Cancelled.
- The initial filter can be **deep-linked**: `?overall=`, `?cancelled=1`,
  `?stage=` — which is how the Dashboard KPIs and pipeline bars navigate here.
  The page wraps the board in `<Suspense>` because it uses `useSearchParams`.
- A fully-cancelled group has `currentStageKey = null`, so it never leaks into
  the "At stage" filter.
- The detail drawer (`status-drawer.tsx`) and CSV export stay line-level.

### 10.7 Operations tracking (`/tracking`, `/tracking/:id`)

`components/tracking/tracking-index.tsx` (the order picker) and
`tracking-board.tsx` (~1,290 lines — the 7-stage grid).

- One row per **active** (non-cancelled, non-deleted) line item.
- Planned and actual dates are hidden by default and revealed on hover — **the
  cell tint is the status**:

  | Cell state | Colour | Extra |
  |---|---|---|
  | Done on time | green | no pill |
  | Done late | amber | `+Xm` delay pill |
  | Live (first not-done) | indigo / accent | |
  | Overdue (live and past planned) | red | |
  | Out of stock | red | "Blocked" |
  | Locked / pending | grey | |

  Derived by `cellState()` inside the board component.
- Only the **live** cell and the **last-done** cell are editable per row, which
  keeps the grid from becoming a free-for-all.
- `stock_checking` is not a checkbox — it is a **Pending / In stock / Out of
  stock dropdown**.
- Each column header has a prerequisite-aware **"mark all"**: it marks every
  line done for that stage but **skips lines whose stock is not `in_stock`**,
  reporting how many it skipped. `order_entry`'s check-all applies to every
  line. `stock_checking` has no check-all — it is per-line by nature. The
  header's "all done" state is measured over *in-play* (completable-or-done)
  lines, so out-of-stock lines cannot block un-checking everything.
- A colour legend strip explains the tints.
- Reads `GET /api/orders/:id/tracking`; writes `PATCH /api/tracking/stage`,
  which returns 409 on a rule violation, a cancelled line, or a deleted line.
- Updates are **optimistic** and roll back with a toast on error.

### 10.8 Trash (`/trash`, and Settings → Trash)

`components/trash/trash-view.tsx`, fed by `GET /api/trash`
(`orders.edit`-gated). Two groups:

- **Deleted orders** — every line deleted; shown as one aggregated card.
- **Deleted designs** — individually deleted lines inside still-active orders.

Each offers **Restore** (`PATCH …/delete` with `deleted: false`) and **Delete
permanently**. Desktop uses tables, mobile uses cards.

### 10.9 Settings (`/settings`, ADMIN only)

Six tabs in `components/settings/settings-view.tsx`:

| Tab | Component | What it does |
|---|---|---|
| **Dropdown Master** | `dropdown-master.tsx` | CRUD over `lookup_values` for all six categories, including bulk paste-in and bulk delete. |
| **Design Database** | `design-db.tsx` | Browse and search the `design_database` history; single and bulk delete. |
| **Time tracking** | `time-tracking.tsx` | Edit each stage's `planned_offset_days` — the SLA. Includes a recompute action. |
| **Users** | `users-manage.tsx` | Add users with a temporary password; edit name/email; reset password; activate/deactivate; delete; set role. |
| **Access** | `access-control.tsx` | The Role × Capability matrix. ADMIN row locked. |
| **Trash** | `trash-view.tsx` | The Trash UI, nested here. |

Two guardrails in the Users API worth knowing:

- You cannot change **your own** role or deactivate **your own** account.
- The system refuses any demotion, deactivation, or deletion that would remove
  the **last active ADMIN**, returning 409 "At least one active admin must
  remain."

---

## 11. The 7-stage operations workflow in depth

All of this lives in exactly one file: **`lib/workflow.ts`**. That is a hard
architectural rule — no stage or status logic anywhere else.

### The stages

```
1. order_entry      →  2. stock_checking  →  ┌─ 3. rolling_checking
   (initial step)       (the gate)           ├─ 4. challan
                                             ├─ 5. bill      any order
                                             ├─ 6. dispatch
                                             └─ 7. received_lr
```

### Gating — stock-only, not sequential

This is the rule most people get wrong when reading the UI, so precisely:

1. **`order_entry` has no prerequisite.** It is the initial step and is always
   editable.
2. **`stock_checking` is locked until `order_entry` is done.** No change of any
   kind — not even setting it to "Out of stock".
3. **The five stages after `stock_checking` unlock only when stock is
   `in_stock`.** Once unlocked they can be completed in **any order** — challan
   before rolling is perfectly legal.
4. **Un-ticking is always allowed.** There is no downgrade block.
5. Reverting stock away from `in_stock` does **not** auto-clear downstream
   stages that are already done. They stay done and the line drops to PARTIALLY
   COMPLETED. The UI warns about this. (An earlier auto-cascade was deliberately
   reverted.)

A violation throws `WorkflowError`, which the stage API turns into a **409** with
the message shown directly to the user — e.g. `Complete "Order entry" first.`

### The stock gate

`stock_status` lives on the `stock_checking` row only:

| Value | Meaning | Effect |
|---|---|---|
| `in_stock` | fabric is available | **completes** the stage, unlocks the five downstream stages |
| `out_of_stock` | blocked | records the block; stage stays not-done; downstream stays locked |
| `NULL` | undecided | same as out_of_stock for gating purposes |

Only `in_stock` counts as done. This is why an out-of-stock line can never reach
COMPLETED — it stays PENDING.

### SLA and delay

`planned_at` is a **pure function** of the configuration:

```
planned_at = order_date at 00:00 UTC + workflow_stages.planned_offset_days
```

It is never the previous stage's finish time. Completing a stage **never**
rewrites any `planned_at`. The only thing that moves planned dates is a change
to the order date (handled in the edit reconciliation) or an SLA change in
Settings.

On completion:

```
actual_at     = the client-supplied timestamp, or now()
is_done       = true
delay_minutes = round((actual − planned) / 60000)     signed; positive = late
```

Un-ticking clears `actual_at`, `is_done`, and `delay_minutes`.

### Status derivation

Per line (`computeLineStatus`):

| Condition | Status |
|---|---|
| all 7 stages done | **COMPLETED** |
| at least one of the 5 **post-stock** stages done | **PARTIALLY COMPLETED** |
| nothing done, or only `order_entry` / `stock_checking` | **PENDING** |

Finishing order entry and stock checking alone is deliberately *not* "partial" —
those are preliminary steps.

Per order (`computeOrderStatus`), over its **active** lines:

| Condition | Status |
|---|---|
| no lines | PENDING |
| every line COMPLETED | COMPLETED |
| every line PENDING | PENDING |
| anything else | PARTIALLY COMPLETED |

…except that a fully-cancelled order is **CANCELLED**, which is an order-level,
client-side status only — never stored, never applied to a single line.

### The transaction

`applyStageProgress` does everything inside one `dbx.transaction`:

```
read all 7 stage rows for the line
  → enforce the gating rules (throw WorkflowError on violation)
  → write the target row: planned_at, actual_at, is_done, delay_minutes,
                          stock_status, updated_by, updated_at
  → re-read the rows and return computeLineStatus(...)
```

Reading first and recomputing at the end inside the same transaction is what
makes concurrent ticks safe.

---

## 12. Derived values — nothing redundant is stored

A recurring principle: if a value can be computed, it is not stored.

| Value | How it is obtained |
|---|---|
| `line_total` | A **generated column**: `GENERATED ALWAYS AS (qty_mtr * rate) STORED`. Never written by application code. |
| Order grand total | Summed at read time over the shown line set. Never stored. |
| Line operations status | `computeLineStatus(stage rows)` |
| Order operations status | `computeOrderStatus(active line statuses)` |
| Order **CANCELLED** | `isOrderCancelled(total, cancelled)` = `total > 0 && cancelled === total`, over non-deleted lines |
| Order **deleted** | `isOrderDeleted(total, deleted)` = `total > 0 && deleted === total`. There is no header flag — deleting an order's last active design is what moves the order to Trash. |
| Order-level stage state | Folded from the line-level stage cells (done only when every line is done; stock folded as: any out → out, all in → in, else null) |

---

## 13. Complete API reference

All handlers live under `app/api`, return JSON, and follow the same envelope:

- success → `{ "data": … }`
- error → `{ "error": "human readable message" }`

Status codes used consistently: **401** unauthenticated · **403** forbidden ·
**404** not found · **409** conflict (duplicate order number, workflow rule
violation, last-admin guard, purge guard) · **422** validation failure (the
first zod message) · **500** unexpected.

`lib/api-client.ts` unwraps the envelope on the client and throws the `error`
string, so TanStack Query and every mutation surface a clean message.

### Orders

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/orders` | `orders.view` **or** `operations.view` | List with rolled-up qty/total/status. Params: `search`, `page`, `order_no`, `challan_no`, `lot_no`, `haste`, `from`, `to`, `all=1`. Page size 20; `all=1` caps at 5,000. |
| `POST /api/orders` | `orders.edit` | Create header + lines + 7 stage rows each + design log, in one transaction. → 201 |
| `GET /api/orders/:id` | `orders.view` **or** `orders.edit` | Header, lines with status, reconstructed fabric blocks, totals. |
| `PUT /api/orders/:id` | `orders.edit` | Edit with stage-preserving reconciliation (§10.5). |
| `DELETE /api/orders/:id` | `orders.edit` | **Permanent purge.** Refuses (409) unless the order is already fully soft-deleted. |
| `GET /api/orders/check-no` | any role | Live duplicate check for the form. |
| `PATCH /api/orders/:id/cancel` | `orders.edit` | `{ line_id?, cancelled }` — one design or the whole order. Bumps `updated_at`. |
| `PATCH /api/orders/:id/delete` | `orders.edit` | `{ line_id?, deleted }` — soft delete/restore. Bumps `updated_at`. |
| `DELETE /api/orders/:id/lines/:lineId` | `orders.edit` | Purge one line; the `is_deleted` guard is inside the WHERE clause. |
| `GET /api/orders/:id/tracking` | `operations.view` | The 7-stage grid data for one order. |

### Operations

| Method & path | Guard | Purpose |
|---|---|---|
| `PATCH /api/tracking/stage` | `operations.edit` | Tick/untick one stage on one line. 404 if the line is missing; **409** if deleted, cancelled, or the change breaks a workflow rule. |

### Order status

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/order-status` | `orders.view` | Line-level rows with per-stage state for the board. |
| `GET /api/order-status/:id` | `orders.view` | Detail for the drawer. |

### Dashboard, trash, health

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/dashboard` | any role | All dashboard aggregates, server-computed. |
| `GET /api/trash` | `orders.edit` | Deleted orders + deleted designs. |
| `GET /api/health` | **public** | Liveness probe: `{ ok, version, counts }`. `dynamic = "force-dynamic"`. |

### Master data and administration

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/lookups` | any role | Autocomplete values by category. |
| `POST /api/lookups` | ADMIN | Add a value. |
| `PATCH /api/lookups/:id` · `DELETE /api/lookups/:id` | ADMIN | Edit / deactivate / remove. |
| `POST /api/lookups/bulk` · `DELETE /api/lookups/bulk` | ADMIN | Bulk paste-in and bulk delete. |
| `GET /api/designs` | any role | Design suggestions, optionally scoped by `?fabric=`. Deduped, most recent first, max 50. |
| `GET /api/design-database` | ADMIN | Browse the design history. |
| `DELETE /api/design-database/:id` · `POST /api/design-database/bulk-delete` | ADMIN | Remove history rows. |
| `GET /api/stages` | ADMIN | The 7 stages + SLA offsets. |
| `PATCH /api/stages/:stage_key` | ADMIN | Change one stage's `planned_offset_days`. |
| `POST /api/stages/recompute` | ADMIN | Recompute planned dates after an SLA change. |
| `GET /api/users` · `POST /api/users` | ADMIN | List / create users. |
| `PATCH /api/users/:id` · `DELETE /api/users/:id` | ADMIN | Update / delete, with the self-edit and last-admin guards. |
| `GET /api/access` · `PUT /api/access` | ADMIN | Read / toggle the Role × Capability matrix. |
| `/api/auth/[...nextauth]` | — | NextAuth handlers. |

### Export

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/export/orders` | **`x-api-key` header** | The Embroidery System's incremental pull. See §14. |

---

## 14. The export API (Embroidery System integration)

`GET /api/export/orders` is the one endpoint that is **not** behind the user
session. The middleware matcher explicitly excludes `api/export`, and the route
authenticates with a static API key instead.

**Authentication.** The caller sends `x-api-key`. The route compares it against
`process.env.EXPORT_API_KEY` with `timingSafeEqual` after a length check, so a
wrong key cannot be discovered character by character.

**Query parameters.**

| Param | Default | Notes |
|---|---|---|
| `updated_since` | — | ISO timestamp. **Inclusive** — the Embroidery side dedupes on stable ids, so the boundary record may legitimately repeat. Invalid values → 400. |
| `page` | 1 | |
| `limit` | 100 | capped at 500 |

**Ordering** is `(updated_at ASC, id ASC)` — stable, which is what makes
incremental paging reliable.

**Response shape:**

```json
{
  "data": {
    "orders": [
      {
        "id": "uuid",
        "order_no": "LKD-08-25-003",
        "order_date": "2026-08-11",
        "party_name": "…",
        "sales_person": "…",
        "department": "LD",
        "updated_at": "2026-08-11T09:14:22.101Z",
        "line_items": [
          {
            "id": "uuid",
            "quality": "Cotton",
            "design_no": "D-114",
            "qty_mtr": "250.00",
            "is_cancelled": false,
            "is_deleted": false,
            "operations_status": "PARTIALLY COMPLETED"
          }
        ]
      }
    ],
    "page": 1, "limit": 100, "total": 412, "total_pages": 5
  }
}
```

**Two rules that must not change:**

1. **No pricing is ever exported.** `rate` and `line_total` are not selected.
2. **Soft-deleted lines ARE emitted**, flagged `is_deleted: true`. Hiding them
   would leave the Embroidery System holding a stale record it can never learn
   to remove.

Because cancel and soft-delete both bump `customer_orders.updated_at`, those
changes reliably re-appear in the next incremental pull.

---

## 15. Client-side data flow and state

### Server state — TanStack Query

Configured once in `app/providers.tsx`: `staleTime` 60s, `gcTime` 5min,
`refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: 1`. The
query client is created once per browser session so the cache survives client
navigations.

The standard mutation pattern used throughout (the Access matrix is the clearest
example):

```
onMutate   → cancel in-flight queries, snapshot the cache, write the optimistic value
onError    → restore the snapshot, toast.error(e.message)
onSettled  → invalidate so the server value wins
```

The tracking board applies the same pattern to stage ticks, which is what makes
the grid feel instant while still being fully server-authoritative.

### UI state

Plain React state. A few things persist to `localStorage`:

| Key | Purpose |
|---|---|
| `oe:new-order-draft:v1` | New-order form draft (create mode only) |
| `sidebar-collapsed` | Sidebar collapsed/expanded |
| Order-status column prefs | Which columns the user has chosen (`useColumnPrefs`) |

Every `localStorage` access is wrapped in try/catch, so a locked-down browser
degrades gracefully rather than crashing the shell.

### URL state

Deep links carry filters: `/order-status?overall=…&cancelled=1&stage=…` and
`/tracking?stage=…`. Pages using `useSearchParams` are wrapped in `<Suspense>`.

---

## 16. Design system

### Tokens

Defined as CSS variables in `app/globals.css` and exposed to Tailwind v4 through
`@theme inline`. `next-themes` writes `data-theme` on `<html>`, and a custom
variant maps Tailwind's `dark:` to it:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

| Token group | Tokens |
|---|---|
| Surfaces | `--canvas` `--surface` `--surface-2` `--inset` |
| Text | `--ink` `--ink-soft` `--ink-muted` |
| Lines | `--line` `--line-strong` |
| Accent | `--accent` (`#4f46e5` light / `#818cf8` dark), `--accent-soft`, `--accent-deep` |
| Semantic | `--success` `--warning` `--danger` |
| Radius | `--radius-card` 16px · `--radius-field` 10px · `--radius-pill` 999px |
| Shadow | `--shadow-sm/md/lg` |

**Always prefer `text-ink` over a literal `black`** — that is what makes dark
mode work without per-component overrides. `.num` applies JetBrains Mono with
tabular figures for aligned numeric columns.

### Stage colours

| Stage | Dot |
|---|---|
| order_entry | indigo |
| stock_checking | blue |
| rolling_checking | amber |
| challan | rose |
| bill | emerald |
| dispatch | violet |
| received_lr | cyan |

Reused for the Dashboard pipeline bars and the Order-status dots. **Always
rendered with a stage-name label**, because these seven hues are close together
under colour blindness.

### Status pills (`components/ui/status-badge.tsx`)

COMPLETED green · PARTIALLY COMPLETED amber · PENDING grey · CANCELLED danger.
Cancelled designs render `text-ink-muted line-through`.

### Responsive strategy

Not a single responsive approach but two deliberate renderings. Desktop gets
tables; mobile gets stacked cards; both are driven by the same data and, where
controls are involved, literally the same helper functions (see the
`roleSelect` / `statusToggle` / `userActions` helpers in `users-manage.tsx`) so
the two views cannot drift apart. Wide grids scroll inside `overflow-x-auto`.

### Conventions

Sentence case throughout. Tables are the primary data surface. Semantic tokens
only — never raw hex in components. Both themes always.

---

## 17. Database access patterns

`lib/db.ts` is the only file that opens a connection. It exports **one** client under two names:

```ts
const client = postgres(DATABASE_URL, { prepare: false, max: 5 });
export const db  = drizzle(client, { schema });
export const dbx = db;   // alias — postgres.js handles transactions on the same client
```

Neon needed two drivers because its HTTP driver could not hold a transaction
across `await`s. postgres.js can, so the split is gone — `dbx` survives only as
an alias so the six transaction call sites did not have to change.

`prepare: false` is **required**: runtime connects through Supabase's Supavisor
transaction pooler (port 6543), which hands a different backend connection to
each transaction, so server-side prepared statements cannot be reused. Schema
DDL uses `DIRECT_URL` (port 5432) instead — the pooler cannot run migrations.

Everything multi-step goes through `dbx.transaction`: order create, order edit,
stage updates, cancel, and soft-delete.

### The `ws` / `bufferutil` workaround is gone

Neon's pool driver used the `ws` package, and bundling it stubbed the optional
native `bufferutil` as an empty object — so `ws` called an undefined
`bufferUtil.mask` and **every interactive transaction died**. `next.config.ts`
had to mark those packages external to work around it. postgres.js is pure JS
over a plain TCP socket, so that entire failure mode no longer exists and the
`serverExternalPackages` entry has been removed.

### Query conventions

- No raw SQL in application code, except narrow tagged `sql` fragments for
  aggregates such as `count(*) filter (where …)`.
- Independent queries run concurrently with `Promise.all` — the orders list
  fires its count, its page, and its cancellation aggregate in one round trip.
- N+1 is avoided by fetching children with `inArray(...)` and grouping into
  `Map`s in memory.
- `and()` drops `undefined` operands and returns `undefined` if none remain,
  which is what lets the filter builders compose cleanly.

---

## 18. Migrations — history and the manual-apply rule

### History

**Current:** a single baseline, `0000_boring_joseph.sql`, which creates the
`ld_order_entry` schema, the `user_role` enum and all 8 tables. It is what built
the Supabase database.

**Archived** under `db/migrations/_archive_neon_public/` — the Neon-era
`public`-schema history, kept for the record and never replayed:

| # | File | What it did |
|---|---|---|
| 0000 | `0000_init.sql` | Initial schema — all core tables |
| 0001 | `0001_new_peter_quill.sql` | `workflow_stages.planned_offset_days` (the SLA) |
| 0002 | `0002_slim_nightmare.sql` | `line_stage_progress.stock_status` |
| 0003 | `0003_smart_sally_floyd.sql` | Adds `MANAGER` to the `user_role` enum |
| 0004 | `0004_sturdy_lightspeed.sql` | `role_permissions` table |
| 0005 | `0005_round_meggan.sql` | `order_line_items.is_deleted` (soft delete) |
| 0006 | `0006_drop_manager_role.sql` | **Removed `MANAGER`** — recreated the `user_role` enum without it, reassigned any leftover MANAGER user to OPS, cleared its `role_permissions` rows. Applied to Neon production before the Supabase migration. |

### `db:migrate` works again

On Neon this was broken: the database had been set up with `db:push` and manual
SQL, so drizzle's `__drizzle_migrations` table was empty and `drizzle-kit
migrate` always tried to replay from `0000_init`, failing on existing tables
with the error hidden behind the CLI spinner.

The Supabase move fixed it. The schema was rebuilt from a freshly generated
baseline, so the migration files and the database now agree.

Three rules:

- **Migrations use `DIRECT_URL`** (port 5432), never the transaction pooler.
- **`drizzle.config.ts` sets `schemaFilter: ["ld_order_entry"]`.** Without it,
  drizzle-kit introspects every schema it can reach in the shared project, finds
  the other apps' tables missing from `db/schema.ts`, and proposes to DROP them.
- **The journal is baselined.** `drizzle.__drizzle_migrations` holds one row for
  `0000_boring_joseph` — hash = sha256 of the migration file, `created_at` = its
  `when` from `_journal.json`. The schema was built by running that SQL directly,
  so without this row drizzle would try to replay the baseline and fail on
  `CREATE SCHEMA`, recreating the exact Neon problem. `npm run db:migrate` exits
  clean and applies only genuinely new migrations.

**Apply each migration's SQL directly** in the Neon SQL console, or with a
one-off `@neondatabase/serverless` script. All migration SQL is written to be
idempotent (`ADD COLUMN IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, and in 0006 a
`DO` block guarded on the enum label still existing).

**A new column or enum value must be applied to BOTH the dev database and
production before or as the code that reads it deploys**, or production queries
fail with `column … does not exist`.

Two Postgres facts the migrations work around:

- `ALTER TYPE … ADD VALUE` **cannot run inside a transaction** (migration 0003).
- There is **no `ALTER TYPE … DROP VALUE`** at all, which is why 0006 recreates
  the type and re-points both dependent columns at the new one.

---

## 19. Environment variables

Local values live in `.env.local` (gitignored); `.env.example` is the template.
Vercel production keeps its own set.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | Supabase **transaction pooler** (port 6543). `lib/db.ts` throws at import time if it is missing. |

> **Getting this port wrong takes the site down.** Session mode (5432) holds a
> connection per client for its whole lifetime against a 15-connection limit, so a
> few warm serverless instances exhaust it and every query fails with `max clients
> reached in session mode` — surfacing as a blanket 500. `lib/db.ts` logs an
> explicit error if it sees 5432 in production.
| `DIRECT_URL` | for DDL | Supabase direct/session connection (port 5432). Used only by drizzle-kit. |
| `DB_SCHEMA` | dev only | Overrides the schema name — set to `ld_order_entry_dev` locally. **Ignored when `NODE_ENV=production`**, so it cannot redirect the live app, and overridden by `db/force-prod-schema.ts` for drizzle-kit so migrations always target production. |
| `AUTH_SECRET` | **yes** | Signs and encrypts session JWTs. Generate with `npx auth secret`. |
| `EXPORT_API_KEY` | **yes** | The static key the Embroidery System sends as `x-api-key`. |
| `AUTH_GOOGLE_ID` | no | Blank → the Google provider is not registered and the login button is hidden. |
| `AUTH_GOOGLE_SECRET` | no | Same. |
| `NEXT_PUBLIC_APP_VERSION` | no | Shown in the footer and `/api/health`. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | no | Override the seeded admin (defaults: `admin@ldorderentry.local` / `ChangeMe123!`). |

**Notes.** The dev database is a Neon instance in Singapore (`ap-southeast-1`).
`.env.local` contains two `DATABASE_URL` lines with the second commented out —
**the first uncommented one wins**. For Google OAuth on Vercel, the credentials
must be set in the **Production** environment and the OAuth client's redirect
URI must include the production `…/api/auth/callback/google`.

`db/load-env.ts` exists because Next.js loads `.env.local` automatically at
runtime but plain Node/tsx scripts do not — seed and drizzle-kit import it
first, before anything reads `process.env`.

---

## 20. Local development workflow

```bash
npm install
cp .env.example .env.local        # then fill in DATABASE_URL, AUTH_SECRET, EXPORT_API_KEY

npm run db:seed                   # 7 stages, sample lookups, one ADMIN, the access matrix
npm run dev                       # http://localhost:3000  (Turbopack)
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with Turbopack |
| `npm run build` | Production build with Turbopack |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | drizzle-kit generate — produce a migration from schema changes |
| `npm run db:migrate` | **Does not work here** — see §18 |
| `npm run db:push` | Push the schema directly (use with care; it is how the DB drifted from the migration history) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Idempotent seed |

Type-checking is not a script — run `npx tsc --noEmit`.

**Local dev writes to `ld_order_entry_dev`**, not the live schema — a structural
twin in the same Supabase project, seeded but empty of orders. That is what
`DB_SCHEMA` in `.env.local` selects.

To verify a change that touches the **write** path without a local database,
run `npx tsx db/verify-write-path.ts`. It exercises a real transaction, the
7-stage seeding, the stock gate, the generated column and cascade delete, then
deletes everything it created — safe against production.

The seed is safe to re-run: stages and role permissions use
`onConflictDoNothing` (so administrator edits to the access matrix survive),
lookups are diffed before insert, and the admin user is only created if absent.
It never creates orders.

---

## 21. Build and deployment

- **Host:** Vercel. **Database:** Supabase *LD Silk Mills* (ap-south-1, Mumbai) — set the Vercel function region to `bom1` to match, or every query crosses a continent.
- **Repository:** `github.com/mastersystem-linkd/LD-Order-Entry`.
- **Branch:** `main`. There is no `.vercel` project link in the repo, so
  production deploys are driven by the **Vercel ↔ GitHub integration** — pushing
  to `main` triggers a production build.
- **Build command:** `next build --turbopack`.
- **History convention:** direct commits to `main`; no PR workflow.

**Deployment checklist:**

1. `npx tsc --noEmit` — clean.
2. `npm run build` — succeeds.
3. **Apply any pending migration SQL to both the dev and production Neon
   databases first** (§18). Deploying code that reads a column before the column
   exists breaks production.
4. Commit and push to `main`.
5. Watch the build in the Vercel dashboard.

---

## 22. Verification scripts

Six standalone `tsx` scripts at the repository root — `verify-p2.ts`,
`verify-p4.ts`, `verify-p5.ts`, `verify-users.ts`, `verify-dashboard.ts`,
`verify-order-status.ts`.

Each imports `./db/load-env`, hits `http://localhost:3000` **against a running
dev server**, checks both the HTTP responses and the resulting database rows,
and prints `PASS` / `FAIL` lines with a non-zero exit on failure. They are
end-to-end smoke checks written alongside each build phase, not a unit-test
suite — there is no test runner in this project.

Run one with:

```bash
npx tsx verify-p2.ts        # dev server must already be running
```

---

## 23. Known constraints and gotchas

1. **Access changes apply on next login.** Capabilities are resolved into the
   JWT at sign-in. Tell users to sign out and back in after a matrix change.
2. **Never let drizzle-kit run without `schemaFilter`.** The Supabase project is
   shared; without the fence it will propose dropping other apps' tables.
3. **Migrations must reach production before the code that reads them.**
4. **`prepare: false` in `lib/db.ts` is load-bearing** — the transaction pooler
   cannot reuse server-side prepared statements.
5. **Never write `line_total`.** It is a generated column; writing it errors.
6. **Never store an order-level cancelled or deleted flag.** Both are derived.
7. **Never hard-delete from a list.** Soft-delete to Trash; purge only from
   Trash, and only through the guarded endpoints.
8. **Order numbers are text and never auto-generated.**
9. **Whole-order cancel-restore un-cancels every line**, because no per-line
   cancel scope is recorded. Known, accepted, recoverable.
10. **The `all=1` orders fetch is capped at 5,000.** Client-side pagination over
    the full set is what makes the KPI cards exact; beyond that cap the design
    would need revisiting.
11. **Point local dev at a non-production database.** The Supabase project is now
    the live system of record; there is no separate prod/dev split by default.
12. **Google sign-in never auto-provisions.** An admin must create the account
    first, or the sign-in is rejected.
13. **Moving data between major Postgres versions needs care.** Neon ran 18.4 and
    Supabase runs 17.6; Postgres restores forwards only, so `pg_dump` was
    unusable and the rows were moved with `db/copy-to-supabase.ts` instead.
14. **postgres.js re-serialises parameters using the type the server infers.**
    Binding a text value to a `boolean` column silently stores FALSE, and to a
    `timestamptz` column truncates microseconds — with no error either time. The
    copy script therefore binds every value as `$n::text::<type>`.

---

## 24. Glossary

| Term | Meaning |
|---|---|
| **Quality** | The **fabric** name. The database column is `quality`; the UI says "Fabric". |
| **Design no** | The design identifier within a fabric. Always text. |
| **Party** | The customer. |
| **Haste** | Urgency (Urgent / Normal / Low). |
| **Challan** | The delivery/dispatch document number. |
| **Lot no** | The production lot identifier. |
| **LR** | Lorry Receipt — the transporter's consignment note. "Received LR" is the final stage. |
| **TAT** | Turnaround time — the 7-stage journey each design line takes. |
| **SLA** | `planned_offset_days` per stage: days from the order date to that stage's deadline. |
| **Line item / design line** | One (fabric, design, quantity) row on an order. The unit that operations tracking follows. |
| **Fabric block** | A UI grouping in the order form: one fabric + one rate + many designs. Expanded into individual line items on save. |
| **Capability** | One of the four permission keys toggled in the Access matrix. |
| **Trash** | Where soft-deleted orders and designs live until restored or purged. |
| **Embroidery System** | The separate downstream application that pulls order data from this one. |
| **Department** | `LD` (default) or `LINKD` — a filter dimension on the dashboard. |

---

## 25. The Neon → Supabase migration (2026-08-18)

Recorded because two of its failures are worth never repeating.

**Why `pg_dump` could not be used.** Neon ran Postgres 18.4, Supabase runs 17.6.
Postgres restores forwards only, so the dump route was closed. The structure was
built instead from `db/schema.ts` via a generated baseline migration, and only
the rows were moved — rows are version-agnostic, schema DDL is not.

**Two silent corruptions, caught by verification rather than by errors.**
`db/copy-to-supabase.ts` reported "8/8 tables copied" while writing wrong data,
twice. postgres.js re-serialises each parameter using the type the *server*
infers for it:

- a text value bound to a `boolean` column fails its `=== true` check and is
  stored as **FALSE** — this wiped all 35 cancellations, the trashed design, and
  **14,382 completed tracking stages**;
- a text value bound to a `timestamptz` column goes through `new Date()`,
  truncating microseconds to milliseconds.

Neither raised an error. Row counts and rupee totals matched perfectly
throughout, because counts and sums don't cover boolean columns. What caught it
was the **row-fingerprint pass** — md5 over every field of every row — which is
why that pass exists. The fix binds every value as `$n::text::<type>` so
Postgres performs all conversions server-side.

**The cutover sequence**, which is what made "no data loss" a guarantee rather
than a hope: freeze Neon read-only → copy → verify → deploy. Freezing first
closes the window in which an order could be written to Neon after the copy read
it. Neon was never written to at any point and remains a complete backup.

**One process error worth noting:** the Vercel environment variables were added
and a deploy triggered *before* the new code was pushed, so the old Neon driver
went live pointed at a Supabase URL and the site returned 500s until the correct
code was pushed. Environment variables and code must land together.

---

*Written from a full read of the codebase. When behaviour and this document
disagree, the code is right and this document should be corrected. `CLAUDE.md`
remains the authority on what may and may not change.*
