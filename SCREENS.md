# SCREENS.md — build-to-print specification

> **Purpose.** This file describes the six core screens precisely enough to
> rebuild them without seeing the original: every region, every field, every
> size, every behaviour. It is written for an engineer (or an AI) working from
> nothing but this document.
>
> **Authority.** `CLAUDE.md` remains the constitution — what may and may not
> change. `PROJECTFLOW.md` explains how the system fits together. **This file
> is the pixel-level and field-level record.** Where any of them disagrees with
> the code, the code is right and the document should be corrected.
>
> **Screens covered:** Dashboard · New order · Orders · Order status ·
> Operations · Settings. (The CRM's five screens are specified in
> `CLAUDE.md §12` and `PROJECTFLOW.md §27`.)

---

## 0. Foundations — read this before any screen

Every screen below assumes these. None of them re-states them.

### 0.1 Stack

Next.js 15 App Router (TS strict, Turbopack) · React 19 · Tailwind v4 ·
shadcn/ui over base-ui · TanStack Query · Recharts · next-themes ·
Drizzle + postgres.js against Supabase Postgres · Auth.js v5 (JWT, no adapter).

### 0.2 Colour tokens

Defined in `app/globals.css` as CSS variables, exposed to Tailwind through
`@theme`. **Never write a literal colour** — dark mode flips the variables.

| Token | Light | Meaning |
|---|---|---|
| `--ink` | `#000000` | headings, primary text, table values |
| `--ink-soft` | `#2b3038` | labels, secondary text |
| `--ink-muted` | `#5c6270` | hints, placeholders |
| `--canvas` | page ground | behind everything |
| `--surface` | card ground | |
| `--surface-2` | recessed | inputs, wells |
| `--inset` | deepest | tracks, chips |
| `--line` | `#ececf0` | hairline dividers, card borders |
| `--line-strong` | `#dee0e5` | input and control borders |
| `--accent` | `#4f46e5` | brand, primary button, active nav |
| `--accent-deep` | `#4338ca` | hover on primary |
| `--accent-soft` | `#eef0ff` | selection tint |
| `--accent-ring` | `rgba(79,70,229,.18)` | focus ring |
| `--success` | `#16a34a` | |
| `--warning` | `#d97706` | |
| `--danger` | `#dc2626` | |

Contrast on white: ink 21.0 : ink-soft 13.3 : ink-muted 6.1. **Three steps are
deliberate** — a table where the value and its caption weigh the same is harder
to scan.

Dark mode mirrors toward white: `#ffffff` / `#d6dae1` / `#a9afba`.

### 0.3 Radii, shadow, type

```
--radius-card   16px     cards, panels
--radius-field  10px     inputs, selects, buttons
--radius-pill   999px    chips, badges, tracks
--sh-sm  0 1px 2px rgba(16,24,40,.05)
--sh-md  0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.05)
--sh-lg  0 4px 12px rgba(16,24,40,.06), 0 16px 40px rgba(16,24,40,.10)
```

Fonts: `font-display` Clash Display (headings, KPI figures) · `font-body`
General Sans (everything else) · `font-mono` JetBrains Mono (rarely).

**`.num`** — apply to every figure, quantity, money and date. It is tabular
figures in the UI sans. It does **not** switch to a mono face: that read as
code on screens that are mostly money. It cannot simply inherit General Sans
either — that face has proportional digits and no `tnum`, so rupee columns
would stagger.

### 0.4 Shared primitives — `components/ui/`

Reuse these. Do not hand-roll a table, a KPI tile or a pager.

| Component | Shape |
|---|---|
| `Card` | `rounded-card`, glass ground, `--card-spacing` 4 (sm) / 6 (default) |
| `CardTitle` | `font-display text-[19px] font-medium tracking-[-0.02em]` |
| `Button` | `rounded-lg`; variants `default` (accent, white text) · `outline` · `ghost` · `destructive` · `link`; sizes `xs` h-6 · `sm` h-7 · `default` h-8 · `lg` h-9 |
| `Input` | **h-[46px]**, `rounded-field`, `border-line-strong`, `bg-surface-2`, `text-[14.5px] font-medium`; focus → accent border + `ring-4 ring-[var(--accent-ring)]` |
| `Table` / `THead` / `Th` / `Td` | the only table markup. `Th`: uppercase 13px bold `tracking-[0.04em]` ink, right rule `border-line/70`. `Td`: `px-3 py-2.5`, right rule `border-line/45`. Both `last:border-r-0`. **One column per table takes `className="w-full"`** to absorb slack — without it every column takes an equal share and the data floats |
| `HScroll` | second horizontal scrollbar **above** the header row, synced both ways, rendered only on overflow. Every wide table uses it |
| `Pager` | Previous · typed page box · Next. The page number is an `<input>` (`h-8 w-12`, numeric) — with 13 pages, walking to page 11 was ten clicks |
| `StatCard` | KPI tile. Props `icon · label · value · sub · tone · trend · onClick · active`. With `onClick` it is a real button (`role`, `tabIndex`, `aria-pressed`, Enter/Space) and `active` draws `border-accent ring-2 ring-accent/25`. Below `sm` it drops the icon square and the sub-label |
| `StatusBadge` | COMPLETED green · PARTIALLY COMPLETED amber · PENDING grey · CANCELLED danger |
| `Segmented` | radiogroup; `tone` neutral/positive/negative; sizes sm/md |
| `Autocomplete` | free text + suggestions. **Keyed by position, never by value** — these lists have no uniqueness guarantee, and a duplicate must not break the list |
| `Reveal` | staggered mount animation, `index` prop |

### 0.5 The shell — `app/(app)/layout.tsx` + `components/app-shell/`

Server layout re-checks the session (defence in depth behind middleware) and
passes `role`, `caps`, `user` into the client `AppShell`.

```
┌──────────┬──────────────────────────────────────────────┐
│ Sidebar  │ Header  (sticky, z-20, glass, border-b)      │
│ 252px    ├──────────────────────────────────────────────┤
│ (64px    │ <main> px-4 py-3 · sm:px-5 sm:py-4 · lg:px-7 │
│ collapsed)│   ← every screen below renders here          │
│          ├──────────────────────────────────────────────┤
│          │ Footer                                       │
└──────────┴──────────────────────────────────────────────┘
```

**Sidebar** (`hidden md:block`) — 252px open, **64px collapsed**, `transition-[width] duration-200`.
Collapsed state persists in `localStorage["sidebar-collapsed"]`.
Collapsed, the aside **expands over the content on hover** (`group/sb`,
`hover:w-[252px] hover:z-30 hover:shadow-lg`) so the page never shifts.

- Brand: 38px `rounded-[11px]` accent square reading `LD`, then "Order Entry"
  at `font-display text-[15px]`, then the collapse toggle (28px).
- `Menu` label: `text-[11px] font-semibold uppercase tracking-[0.07em] ink-muted`.
- Item: `rounded-[10px] px-3 py-[9px] text-[13.5px] font-medium`, 18px icon.
  Active → `bg-accent text-white shadow-sm`; otherwise `text-ink-soft hover:bg-inset`.
- **Active = the item whose href is the longest prefix of the path.**
- A group with `children` (CRM) opens a rail **only while that section is
  active** — `ml-[26px] border-l border-line pl-3`, child `text-[13px]`, active
  child `bg-accent-soft text-accent-deep`. Child match is **exact**, because
  the parent's own href is also a child and a prefix test would light every
  sibling.
- Footer of the rail: role avatar (32px circle, accent) + "Signed in as …".

**Header** — `sticky top-0 z-20 glass border-b border-line px-4 py-3.5 sm:px-5 lg:px-7`.
Left to right: mobile menu (md:hidden) · sidebar toggle (hidden md:grid) ·
back · **title** · theme toggle · sign-out · user chip.
All icon buttons share `grid size-[38px] rounded-[10px] border-line bg-surface`
with `hover:bg-inset active:scale-[.98]`.
Title: `font-display text-[17px] sm:text-[20px] font-semibold tracking-[-0.02em]`,
derived from the path by `titleFor()` — `/` → Dashboard, `/orders/new` → New
order, `/orders/:id/edit` → Edit order, a CRM child by its own label, otherwise
the longest-prefix nav item (with `/orders/:id` → "Order detail").
User chip: `rounded-pill border-line bg-surface`, name `text-[13px] font-medium`
over role `text-[12px] ink-muted`, then a 32px accent circle with the initial.

**Mobile nav** is a near-duplicate of the sidebar in a drawer. **Change both** —
they diverged once and the CRM sections vanished on phones.

### 0.6 Rules that bind every screen

1. **Filter `is_deleted = false` on every read path**; filter
   `is_cancelled = false` additionally on totals and status.
2. `order_no`, `quality`, `design_no`, `challan_no`, `lot_no` are **text** —
   never `parseInt`.
3. `line_total` is a **generated column**. Never write it. Never store an order
   total; derive it.
4. Every write payload goes through a zod schema in `lib/validation.ts`.
5. API shape: `{ data }` on success, `{ error }` on failure. Guards are
   `requireCapability` / `requireRole` from `lib/api.ts`.
6. **Never fan out more than 4 concurrent queries.** `lib/db.ts` caps
   postgres.js at `max: 5`, and through the Supavisor pooler the surplus does
   not queue — it stalls the request for minutes. One wedged endpoint blocks
   every screen in that process.
7. Sentence case in UI copy. Tables are the primary presentation.
8. Light **and** dark must both work — use tokens, never literals.

---

## 1. Dashboard — `/`

**Route** `app/(app)/page.tsx` (server) → `components/dashboard/dashboard-view.tsx`
**Data** `lib/dashboard-query.ts → loadDashboard()`, served by `GET /api/dashboard`
**Access** any authenticated user

### 1.1 Data flow — the part that matters

The page is a **server component that prefetches** `loadDashboard()` during SSR
and hands the result to the client query as `initialData`. The client refetches
through `/api/dashboard` only when a filter changes.

Do not make this a client-only fetch. It was one, and the request could not
start until ~300 kB of route JS had downloaded and hydrated. Recharts is behind
`next/dynamic`, and `OnTimeGauge` (raw SVG, no library) sits in its own file to
stay out of that chunk — 300 kB → 186 kB.

**Every aggregate excludes cancelled AND soft-deleted lines**, and excludes
fully-deleted orders via `EXISTS(non-deleted line)`. Roll-ups happen **in SQL**:
an earlier version pulled ~13,000 rows to render seven bars and a ten-row list.

### 1.2 Layout, top to bottom

Root: `flex flex-col gap-4 pb-4`.

#### A. Filter bar
`flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm`

| Control | Spec |
|---|---|
| Range presets | pill buttons, `aria-pressed`; active `bg-accent text-white`, idle `border-line-strong bg-surface-2 text-ink-soft` |
| Month select | `h-9 rounded-field border-line-strong bg-surface-2 px-2 text-[13px]`; options read `August 2026 (14)` or `— none` |
| From / To dates | two `Input type="date"`, `.num h-9`, `sm:w-[150px]`, separated by an en dash. `from` sets `max={to}`, `to` sets `min={from}` |
| Refresh | `Button variant="outline" size="icon"`, `ml-auto`, icon spins while fetching |

#### B. KPI row — 6 tiles
`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6`, wrapped in `<Reveal index={0}>`.

Each is a `MiniStat` = `StatCard` whose value is a `<NumberFlow>` (animated
count-up, `maximumFractionDigits: 0`) wrapped in a `Link`. The link adds
`hover:-translate-y-0.5`.

| # | Label | Value | Tone | Deep-links to |
|---|---|---|---|---|
| 1 | Total orders | `kpis.orders` | indigo | `/orders` |
| 2 | Order value | `kpis.value` (₹ prefix) | green | `/orders` |
| 3 | Meters | `kpis.meters` (` m` suffix) | amber | `/orders` |
| 4 | Active orders | `kpis.activeOrders` | indigo | `/order-status?overall=in_progress` |
| 5 | Overdue stages | `kpis.overdueStages` | red | `/order-status?overall=overdue` |
| 6 | On-time % | `kpis.onTimePct` (`%` suffix) | green | `/order-status` |

**Every tile deep-links.** A figure you cannot open is a dead end.

#### C. Operations pipeline
`Section title="Operations pipeline"`, action text *"lines awaiting each stage"*.

Seven rows, one per stage, each a `Link` to `/tracking?stage=<key>`:

```
[dot] Stage label (w-[104px] sm:w-[132px])  [track h-2.5 rounded-full bg-inset]  [count w-8]
```
Bar width `max(6, count/max × 100)%`; 0 renders 0%. Row hover `bg-surface-2`.
**The stage name is always present** — the seven stage hues are close under
colour-blindness, so colour is never the only signal.
Empty: *"No active lines in the pipeline."*

Stage dots: order_entry indigo · stock_checking blue · rolling_checking amber ·
challan rose · bill emerald · dispatch violet · received_lr cyan.

#### D. Charts row
`grid gap-3 md:grid-cols-2 lg:grid-cols-4`

| Panel | Span | Content |
|---|---|---|
| **Order trend** | `md:col-span-2` | Recharts area, h-232. Header carries an orders/value pill toggle (`aria-pressed`, active `bg-accent text-white`) |
| **Order status split** | 1 | Donut, h-232 — Completed / Partially / Pending / **Cancelled**, total in the hole |
| **On-time delivery** | 1 | `OnTimeGauge` — raw SVG radial, green ≥90 / amber ≥70 / red |

Loading uses `<Skel className="h-[232px]" />`.

#### E. Cancellations & Trash
`grid gap-3 lg:grid-cols-2`

- **Cancellations** (action: *"this range"*) — `grid grid-cols-3 gap-2.5` of
  `MiniFig`: Cancelled designs · Orders affected · Fully cancelled.
- **Trash** — `grid grid-cols-2`: Deleted designs · Deleted orders, plus a link
  to `/trash`.

#### F. Top lists
`grid gap-3 lg:grid-cols-3`

- **Top parties** — `TopBars`, `bg-accent`, value `₹…`, sub *"N orders"*.
- **Top fabrics** — `TopBars`, `bg-emerald-500`, value `… m`, sub *"meters"*.
- **Recent orders** — rows linking to `/orders/:id`: order no over
  `party · date`, then `₹value` and a `StatusBadge`. Row `rounded-[8px] px-2 py-2 hover:bg-surface-2`.

#### G. Needs attention
`grid gap-2 sm:grid-cols-2`. Each card links to `/tracking/:orderId`:
`rounded-[10px] border-line bg-surface-2 px-3 py-2.5`, hover
`border-danger/40`. Shows order no · party, `Stage: <label>`, and a danger pill
reading `Nd overdue`.
Empty: *"Nothing overdue — you're on track."*

### 1.3 Two behaviours worth preserving

- `recentOrders` and `attention` break ties **deterministically** — by
  `order_no`, and by exact `planned_at` rather than whole days overdue. Before
  that, equal rows came back in database row order and the list reshuffled
  between loads.
- The gauge's denominator is stage-level, not order-level. With the SLA
  offsets at their seed defaults this read 1% and meant nothing; see
  `db/analyse-sla.ts`.

---

## 2. New order — `/orders/new` (and `/orders/:id/edit`)

**Page:** `app/(app)/orders/new/page.tsx` — four lines; it renders
`<OrderForm mode="create" />` and nothing else.
**Component:** `components/orders/order-form.tsx` (~1,140 lines).
**Edit:** the same component with `mode="edit" orderId={id}`. Everything below
applies to both; the differences are called out as **[edit]**.

### 2.1 The shape of the data

One **header** plus N **fabric blocks**, each block holding one fabric, one
rate, and M **design rows**. That nesting is the whole screen. It exists
because a customer orders *"3,000 m of INDIANA CHECKS in six colours"* — one
fabric, one rate, six design numbers — and typing the fabric and rate six times
is how order entry gets abandoned.

```ts
type DesignRow        = { design_no: string; qty_mtr: string };   // strings, not numbers
type FabricBlockState = { fabric: string; rate: string; designs: DesignRow[] };
type HeaderState = {
  order_no; order_date; party_name; sales_person; agent; haste;
  transport; challan_no; lot_no; department; remarks;             // all string
};
```

**Every field is held as a string, including the numeric ones.** A controlled
`<input type="number">` bound to a number cannot represent `""`, `"3."` or
`"0.0"` mid-typing — it snaps back and the user loses the keystroke.
Conversion happens once, in `buildPayload()`.

Initial state:

| | Value |
|---|---|
| `order_date` | `todayISO()` = `new Date().toISOString().slice(0,10)` |
| `party_name` | `"LD Silk Mills"` (`DEFAULT_PARTY` — a pre-fill, not a constraint; §4 keeps it free text) |
| `department` | `"LD"` |
| everything else | `""` |
| `blocks` | `[{ fabric: "", rate: "", designs: [{ design_no: "", qty_mtr: "" }] }]` |

`useState(blankHeader)` passes the **function**, not a call — a lazy
initialiser, so `todayISO()` runs once rather than on every render.

### 2.2 Page frame

```
<form className="mx-auto flex w-full max-w-[1500px] flex-col gap-3
                 pb-[124px] sm:pb-[104px]">
```

The bottom padding is not decoration: the totals bar is `position: fixed`, so
without it the last fabric block sits underneath and cannot be reached. Mobile
needs more (124 vs 104) because the bar wraps to two rows there.

`onSubmit` calls `openPreview()`, never the save. Submitting opens the
confirmation dialog; only the dialog's button writes.

Every top-level region is wrapped in `<Reveal index={n}>` — a small staggered
fade-in. Header is `index={0}`, block *i* is `index={i+1}`, the "add fabric
block" button is `index={blocks.length+1}`.

### 2.3 Region A — Order details card

`<Card data-size="sm" className="gap-3">`

**Header row:** `flex items-center justify-between`
- Left: a `size-7` rounded-`[9px]` tile, `bg-accent-soft text-accent ring-1
  ring-inset ring-accent/15`, holding `<ClipboardListIcon className="size-4" />`,
  then `<CardTitle>Order details</CardTitle>`, gap `2.5`.
- Right **[edit]**: an `<Eyebrow>Editing</Eyebrow>` pill — `rounded-pill
  bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase
  tracking-[0.08em] text-accent`. Absent in create mode.

**Grid:**
```
grid grid-cols-1 gap-x-3 gap-y-2
     sm:grid-cols-2 sm:gap-x-4
     lg:grid-cols-3
     [&_input]:h-9
```
The `[&_input]:h-9` override matters — the global `Input` is `h-[46px]`
(§0.4), which is right for a login form and far too tall for eleven fields.
Here they are **36 px**.

The fields, **in DOM order** (the grid fills left-to-right, so this is also the
visual order):

| # | Label | Control | Suggestions | Notes |
|---|---|---|---|---|
| 1 | Order date * | `Input type="date"` `.num` | — | id `order_date` |
| 2 | Order no * | `Input` `.num` | — | live duplicate check, §2.4 |
| 3 | Party * | `Autocomplete` | `useLookup("PARTY")` | placeholder *"Party name"* |
| 4 | Sales person | `Autocomplete` | `SALES_PERSON` | placeholder *"Search…"* |
| 5 | Agent | `Autocomplete` | `AGENT` | *"Search…"* |
| 6 | Haste | `Autocomplete` | `HASTE` | *"Search…"* — a **company name**, not an urgency (§7) |
| 7 | Transport | `Autocomplete` | `TRANSPORT` | *"Search…"* |
| 8 | Challan no | `Input` | — | placeholder `—` |
| 9 | Lot no | `Input` | — | placeholder `—` |
| 10 | Remarks | `Input` | — | `col-span-1 sm:col-span-2 lg:col-span-3` — **full width**, placeholder *"Optional notes"* |

`department` is in the state and the payload but has **no control** — it is
always `"LD"`. Do not add one without being asked.

**`Field` wrapper** (local, bottom of the file):
```
<div className="flex flex-col gap-[7px]">
  <div className="flex items-center justify-between">
    <Label className="text-[13px] font-medium text-ink-soft">
      {label}{required && <span className="font-semibold text-danger"> *</span>}
    </Label>
    {hint && <span className="text-xs text-{danger|success|ink-muted}">{hint}</span>}
  </div>
  {children}
</div>
```
The hint sits on the **label row, right-aligned** — not under the input, where
it would shift every field below it as it appears and disappears.

### 2.4 The order-no duplicate check

`order_no` is user-entered and UNIQUE (§3.1). The check runs **on blur**, never
per keystroke:

```
onChange → setHeaderField(...) + setDup("idle")     // any edit invalidates
onBlur   → checkOrderNo()
```

`checkOrderNo()` — empty ⇒ `idle`; **[edit]** value unchanged from
`originalOrderNo` ⇒ `available` **without a request** (an order is allowed to
keep its own number); otherwise `checking` → `GET
/api/orders/check-no?orderNo=…` → `available` | `taken`; a thrown request ⇒
`error`.

| `dup` | Hint text | Tone | `aria-invalid` |
|---|---|---|---|
| `idle` / `error` | — | — | false |
| `checking` | `Checking…` | muted | false |
| `available` | `Available` | success | false |
| `taken` | `Already exists` | danger | **true** |

`validate()` blocks on `taken` too, so a race that lets the user submit before
the blur resolves still cannot write a duplicate — and the table's unique
constraint is the third line of defence.

### 2.5 Region B — Fabric blocks

One per block, `blocks.map((block, bi) => …)`, carrying
`data-fabric-block={bi}` (used by the focus effect, §2.7).

**Container:**
```
glass relative overflow-hidden rounded-card border border-line-strong p-3
shadow-sm transition-[transform,box-shadow] duration-200
hover:-translate-y-[2px] hover:shadow-md
motion-reduce:hover:translate-y-0 sm:p-4
```
Two decorations, both `absolute`: an **accent spine** down the left edge
(`inset-y-0 left-0 w-1 bg-gradient-to-b from-accent to-[var(--a3)]`) and a
`size-32` radial glow at `-top-12 -right-12`, `opacity-[0.05]`, `aria-hidden`.

**Block header** — `mb-3 flex items-center justify-between`:
- Left: a `size-[24px]` `rounded-[7px]` gradient chip
  (`from-accent to-[var(--a3)]`, white `text-[12.5px] font-semibold`, `.num`)
  showing `bi + 1`, then the words **Fabric block** at
  `text-[14px] font-semibold text-ink`.
- Right: **Remove** — a ghost button, `text-[13px] text-ink-muted`, hover
  `bg-danger/10 text-danger`, with a `size-[15px]` trash icon.
  **`disabled={blocks.length === 1}`** with `disabled:pointer-events-none
  disabled:opacity-40` — an order always has at least one block.

**Block fields** — `grid grid-cols-[1fr_6rem] gap-2.5
sm:grid-cols-[minmax(180px,1.6fr)_120px]`:

| Field | Control | Size |
|---|---|---|
| Fabric * | `Autocomplete`, placeholder *"Fabric / quality"*, `aria-label="Fabric, block N"` | `h-10 text-[13.5px]` |
| Rate | `Input type="number" min=0 step=0.01`, placeholder `0.00`, `aria-label="Rate per metre, block N"` | `num h-10 px-2 text-right text-[13.5px]` |

**Fabric suggestions are block-scoped.** `fabricOptionsFor(bi)` removes any
fabric already chosen in a *different* block (compared lowercased and trimmed),
so the same fabric cannot be suggested twice. Free text is still accepted —
§3.4 forbids blocking an unknown value; this only prunes the dropdown.

### 2.6 The design rows

A shared column template, declared once so the header strip and the rows can
never drift:

```ts
const DESIGN_ROW_COLS =
  "grid-cols-[minmax(0,1fr)_4rem_5.5rem_2.5rem] " +
  "sm:grid-cols-[minmax(0,1fr)_4rem_5.5rem_4.5rem]";
```

| Column | Width | Contents |
|---|---|---|
| Design no | `minmax(0,1fr)` | `DesignAutocomplete`, `h-10 text-[13.5px]` |
| Qty | `4rem` (64 px) | `Input type="number"`, `num h-10 px-2 text-right text-[13.5px]`, placeholder `0` |
| Total | `5.5rem` (88 px) | read-only `Money`, `h-9 justify-end text-[13px] font-medium text-ink` |
| Actions | `2.5rem` → `4.5rem` at `sm` | + and trash |

The action column is **40 px on mobile and 72 px from `sm` up** because the
per-row **+** button is `hidden … sm:grid` — on a phone the extra 32 px goes to
the design input instead, and rows are added from the block footer.

**Header strip** above the rows: same grid, `text-[11px] font-semibold
uppercase tracking-[0.04em] text-ink-muted`, reading `Design no *` · `Qty`
(right) · `Total` (right) · (empty). Only Design no carries the red asterisk;
qty is validated but not marked.

**Buttons**, both `size-8 grid place-items-center rounded-lg text-ink-muted`:
- **+** — `hover:bg-accent-soft hover:text-accent`, `title="Add design (or
  press Enter)"`, `aria-label="Add design below"`.
- **trash** — `hover:bg-danger/10 hover:text-danger`,
  `disabled={block.designs.length === 1}` at `opacity-30`.

**Design suggestions are fabric-scoped.** `DesignAutocomplete` debounces the
block's fabric by **350 ms** and calls `useDesigns(fabric)`; the suggestions
come from `design_database` (§5) — every design ever used with that fabric.
Without the debounce, typing "INDIANA CHECKS" fires fourteen queries.

**Block footer** — `mt-3 flex flex-wrap items-center justify-between gap-3
border-t border-dashed border-line-strong pt-3`:
- Left: **Add design** (`Button variant="outline" size="sm"`) and
  `<BulkAddDesigns>`.
- Right: `Block qty <b>N</b> · subtotal <b>₹N</b>` at
  `text-[13px] text-ink-soft`, the bold figures `text-[14px] font-semibold text-ink`.

**`BulkAddDesigns`** — the word *Add* (hidden below `sm`), a
`num h-8 w-16 px-2 text-center text-[13px]` number input placeholdered `5`, the
word *rows*, and a ghost **Add** button disabled while the count is < 1. Enter
inside the box submits. Its count lives in its own component so a per-block
draft value never re-renders the whole form. Clamped to
`MAX_BULK_DESIGNS = 100` — a fat-fingered `500` would otherwise mount 500 rows.

### 2.7 Four keyboard and inheritance behaviours

These are what make the screen fast, and they are easy to omit by accident.

1. **Enter anywhere in a design row inserts the next row below it and focuses
   it.** The handler sits on the row `<div>`, and guards on
   `!e.defaultPrevented` — the autocomplete sets that flag when Enter picked a
   suggestion, so choosing a design does not also spawn a row.
2. **New rows inherit the block's qty**, taken from row 0 (`inheritedQty`).
   One fabric in six colours is usually one quantity six times.
3. **Editing row 0's qty cascades** — `setFirstDesignQty` rewrites every other
   row that still holds the *previous* row-0 value or is empty, and leaves
   manual overrides alone. Any other row edits only itself.
4. **Focus follows insertion.** `setPendingFocus({bi, di})`; an effect then
   finds `[data-fabric-block="N"] [aria-label="Design no, row M+1"]` and calls
   `.focus()`, clearing the pending state. It runs on `[pendingFocus, blocks]`
   so the query happens after the new row has rendered. This is why the
   `aria-label` carries the row number and why the block carries a data
   attribute — they are the addressing scheme, not just accessibility.

### 2.8 Region C — Add fabric block

A full-width dashed button, `h-[46px] w-full rounded-field border border-dashed
border-line-strong bg-surface-2 text-[14px] font-medium text-ink`, hover
`border-accent bg-accent-soft text-accent`, `active:scale-[.99]`, with a
`size-4` plus icon.

### 2.9 Region D — Sticky totals bar

```
glass fixed inset-x-0 bottom-0 z-30 border-t border-line
px-4 py-3 shadow-[0_-4px_20px_rgba(16,24,40,0.06)]
sm:px-[34px] sm:py-4 md:left-[264px]
```

`md:left-[264px]` clears the expanded sidebar (252 px + the shell's gutter).
Inside, the same `max-w-[1500px]` as the form, `flex-col gap-3 sm:flex-row
sm:items-center sm:justify-between`, plus a 1 px accent hairline across the top
(`bg-gradient-to-r from-transparent via-accent/40 to-transparent`).

| Slot | Content |
|---|---|
| Left | *GRAND TOTAL* (`text-[12px] font-semibold uppercase tracking-[0.08em] text-accent`) beside `<Money>` at `font-display text-2xl sm:text-[30px] font-semibold tracking-[-0.02em]` |
| Middle | `N fabric · N designs · N mtr`, `text-[13px] text-ink-soft`, **`hidden md:block`** |
| Right | **Cancel** (ghost + `border border-line-strong`, → `/orders`) and **Create order** / **Save changes** (`size="lg"`, check icon) |

`[&>*]:flex-1 sm:[&>*]:flex-none` — on a phone the two buttons split the width
evenly; from `sm` they shrink to their content.

**Money is animated.** `<Money>` wraps `NumberFlow` with `prefix="₹"` and
`min/maximumFractionDigits: 2`, class `.num`. The digits roll as the user types
a rate. This is the screen's one signature effect; the tabular figures are what
keep it from jittering.

Totals are computed on every render, not memoised — `blockTotals` maps each
block to `{ qty, total, rows: [{qty, lineTotal}] }` with
`rate = Number(b.rate) || 0`, and `grandQty` / `grandTotal` / `designCount`
reduce over it. **Nothing here is ever sent**: `line_total` is a generated
column and the grand total is derived (§3.2). These figures exist only to be
looked at.

### 2.10 Validation

`validate()` returns the **first** failure as a sentence, or `null`. Order:

1. `Order no is required.`
2. `Order date is required.`
3. `Party is required.`
4. `Order number "X" already exists.` (when `dup === "taken"`)
5. `Add at least one fabric block.`
6. per block *i*: `Fabric block i: fabric is required.`
7. per block: `Fabric block i: add at least one design row.`
8. per row: `Fabric block i: every design row needs a design no.`
9. per row: `Fabric block i: qty must be greater than 0.`

The message goes to **both** `setFormError` (an inline `role="alert"` banner —
`rounded-field bg-danger/10 px-3.5 py-2.5 text-sm text-danger`, rendered above
the totals bar) and a `toast.error`; the banner may be scrolled off on a long
order.

**`buildPayload()` runs before validation** and does the cleaning: `.trim()` on
every string, `""` → `null` for the eight optional header fields, `department`
defaulting to `"LD"`, `rate` `""` → `null` else `Number()`, and **design rows
that are entirely blank are dropped** (a row survives only if `design_no` or
`qty_mtr` has content). That last rule is why "add 5 rows" is safe: unused rows
disappear rather than failing validation.

> **Party names pass through verbatim** apart from that `.trim()` — never
> case-fold, expand or tidy them (§7, SCOT identity).

### 2.11 Preview dialog

Opened by submit, never skipped. `DialogContent` is `max-h-[85dvh]
overflow-auto sm:max-w-2xl`.

- **Title** — *Confirm new order* / *Confirm changes*; description *"Review the
  order before saving."*
- **Facts** — `<dl className="grid grid-cols-2 gap-x-4 gap-y-2">` of `Detail`
  (`dt` `text-xs text-ink-muted`, `dd` `font-medium text-ink`, `.num` when
  `mono`): Order no · Order date (both mono) · Party · Sales person · Challan
  no · Lot no. Missing values read `—`.
- **Lines** — a table inside `overflow-x-auto rounded-field border border-line`,
  `min-w-[440px]`, `thead` on `bg-inset`: Fabric · Design · Qty (right) · Rate
  (right) · Line total (right); rows `border-t border-line`, cells `px-3 py-2`,
  numbers `.num`. `tfoot` carries a `bg-inset font-medium` row — *Grand total*
  spanning 2, then the qty, an empty rate cell, and `₹total`.
- **Footer** — **Back** (outline, disabled while saving) and **Confirm &
  create** / **Confirm & save**, which shows `<Spinner /> Saving…` while pending.

### 2.12 Save

```
create → POST /api/orders       { order, fabrics }
edit   → PUT  /api/orders/:id   { order, fabrics }
```

On success: close the dialog; **[create]** `localStorage.removeItem(draft key)`;
invalidate `["orders"]` and `["designs"]` (and `["order", orderId]` when
editing); `toast.success("Order X created." / "updated.")`;
`router.push("/orders")` then `router.refresh()`.

On error: close the dialog, set the inline banner, and toast — closed
deliberately, so the message is not hidden behind it.

The server, not this form, creates the **seven `line_stage_progress` rows per
line** with SLA-driven `planned_at` (§6), and on edit preserves progress for
lines still matching on fabric + design + qty. **[edit]** never touches
soft-deleted lines.

### 2.13 Draft autosave — create mode only

Key `oe:new-order-draft:v1`. Two effects:

1. **Restore**, on mount: if `mode !== "create"`, just set `draftReady`.
   Otherwise read and `JSON.parse` the key, apply `header` and (if a non-empty
   array) `blocks`, swallow any error, then `setDraftReady(true)`.
2. **Persist**, on `[draftReady, mode, header, blocks]`: write
   `JSON.stringify({header, blocks})`, swallowing quota/privacy failures.

`draftReady` is **state, not a ref** — deliberately. A ref would already read
`true` during the same commit as the restore, and the persist effect would
overwrite the saved draft with the blank initial state before the restore
landed. That bug only shows up on a real refresh, so keep the state.

### 2.14 Edit-mode hydration

`useQuery(["order", id])` → `GET /api/orders/:id`. While loading, the whole
component returns `<Spinner /> Loading order…` at `text-sm text-ink-muted`; on
error, a `Card` with `py-6 text-sm text-danger`.

Hydration runs **once**, guarded by `hydrated.current` — without it every
refetch would discard whatever the user had typed. It maps nulls to `""`,
stringifies `rate` and `qty_mtr`, falls back to `[blankFabric()]` if the order
somehow has no fabrics and `[blankDesign()]` for a fabric with no designs, and
stores `originalOrderNo` for the duplicate check.

---

## 3. Orders — `/orders`

**Page:** `app/(app)/orders/page.tsx` — a server component that reads
`session.user.caps` and renders `<OrdersScreen caps={caps} />`. Capabilities
come from the JWT, never from a fetch.
**Components:** `orders-screen.tsx` (the switch) → `orders-dashboard.tsx`
(~1,050 lines, the table) or `order-status/order-tracker.tsx` (the tracking
view, specified in §4.4 — it is the same component on both screens).

### 3.1 Two views behind one switch

`OrdersScreen` renders a `ViewSwitch` and one of two screens.

```ts
const { view, setView } = useTrackView("oe:orders:view:v2", "track");
```

- **Tracking is the default.** When it sat behind the switch as the
  non-default, nobody found it — which was the entire problem it was built to
  solve. The table is one click away, and the choice is remembered.
- **The storage key is `…:v2` deliberately.** The earlier default was the
  table; a stored `"table"` under the old key would have kept hiding the
  tracking view from exactly the users who had already visited.
- `useTrackView` reads `localStorage` in an effect (not during render — it must
  not differ between server and client) and wraps both read and write in
  `try/catch`; a private window throws on access and the default must still stand.

**`ViewSwitch`** — a pill segmented control: `inline-flex shrink-0 gap-1
rounded-pill border border-line-strong bg-surface-2 p-0.5`, each button
`rounded-pill px-3 py-1.5 text-[13px] font-medium [&_svg]:size-3.5`, active
`bg-accent text-white`, inactive `text-ink-soft hover:text-ink`, both carrying
`aria-pressed`. Labels: **Tracking** (list icon) and **Orders** (table icon) —
the second label is a prop, because Order status passes *"Board"*.

**New order** travels with the switch. In the tracking view the button is
passed into the tracker's `toolbar` slot rather than being left behind on the
table; it is gated on `orders.edit`.

### 3.2 Orders table — state

| State | Purpose |
|---|---|
| `searchInput` / `search` | typed vs **submitted** — search applies on Enter, not per keystroke |
| `filters` → `debouncedFilters` (300 ms) | the column filter panel |
| `statusFilter` | which KPI card is active; `""` = all |
| `page` | client-side, `PAGE_SIZE = 20` |
| `expanded: Set<string>` | which rows have their designs panel open |
| `selected` | the mobile quick-view popup's order |
| `toDelete` / `toCancel` | the two confirm dialogs |
| `showFilters`, `exporting` | UI only |

**The list fetches the entire matching set.**

```ts
useQuery({
  queryKey: ["orders", { search, filters: debouncedFilters }],
  queryFn: () => apiGet(`/api/orders?${buildParams({ all: "1" })}`),
  placeholderData: (prev) => prev,          // no flash to empty on refetch
})
```

Search and the column filters are applied **server-side**; the KPI status
filter and pagination are applied **client-side**. That split is the point: the
KPI cards must show accurate all-orders counts *and* act as filters, which is
impossible if the client only holds one page. `placeholderData` keeps the old
rows on screen while a new filter loads.

An effect resets `page` to 1 whenever `debouncedFilters`, `search` or
`statusFilter` changes — otherwise a filter that leaves four results while you
are on page 7 shows an empty table.

### 3.3 Region A — KPI cards

`grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5`, inside
`<Reveal index={0}>`. Every card is a filter.

| Card | Tone | Icon | Value | Sub | Sets `statusFilter` |
|---|---|---|---|---|---|
| Total orders | indigo | clipboard | `rows.length` | *Show all* | `""` |
| Completed | green | check | count of `COMPLETED` | *Tap to filter* | `"COMPLETED"` |
| In progress | amber | list-checks | count of `PARTIALLY COMPLETED` | *Tap to filter* | `"PARTIALLY COMPLETED"` |
| Pending | slate | clock | count of `PENDING` | *Tap to filter* | `"PENDING"` |
| Cancelled | rose | x-circle | **Σ `cancelled_line_count`** | `in N orders` | `"cancelled"` |

Note the last one counts **designs**, not orders, while its subtitle counts the
orders they sit in — a single order with three cancelled designs reads
`3 · in 1 order`. Before data arrives every value is `—`, not `0`.

**`MiniStat`** (local): `flex items-center gap-2.5 rounded-card border
bg-surface p-2.5 shadow-sm`, rendered as a `<button type="button">` with
`aria-pressed={active}` when it has an `onClick`, otherwise a plain `div`.
Active state is `border-accent ring-2 ring-[var(--accent-ring)]`; inactive
`border-line hover:border-line-strong`. Inside: a `size-9 rounded-[10px]` icon
tile (`[&_svg]:size-[17px]`) tinted by tone — `bg-success/10 text-success`,
`bg-warning/10 text-warning`, `bg-danger/10 text-danger`, `bg-inset
text-ink-soft`, `bg-accent/10 text-accent` — then a label at `text-[11px]
font-medium text-ink-soft`, the value at `num font-display text-[19px]
font-semibold leading-tight text-ink`, and the sub at `text-[10px] text-ink-muted`.

`visibleRows` applies the filter: `""` → all; `"cancelled"` →
`cancelled_line_count > 0`; anything else → `operations_status === filter`.

### 3.4 Region B — Toolbar

`flex flex-col gap-2 sm:flex-row sm:items-center`:

- **Search** — a `<form>` at `w-full sm:flex-1`, with a `size-4` search icon
  absolutely positioned at `left-2.5 top-1/2 -translate-y-1/2 text-ink-muted`
  and the input at `pl-8`. Placeholder: *"Search order no, party, challan,
  lot…"*. Submitting trims and sets `search` and resets to page 1.
- **Filters** — outline button, `aria-pressed`, with a `size-1.5 rounded-full
  bg-accent` dot appended when any filter is active. Toggles the panel.
- **Refresh** — outline; swaps its icon for a `Spinner` while `isFetching`.
- **Export** — outline; disabled while exporting or with no rows.
- **New order** — primary, `orders.edit` only.

**`OrderFilters`** (`components/orders/order-filters.tsx`, shared with the
tracking view and Order status) — `rounded-field border border-line
bg-surface-2 p-3`, inner `grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3
lg:grid-cols-4 xl:grid-cols-7`. Seven controls, each a `<label>` at
`text-[11px] font-medium text-ink-soft` above its input:

| Field | Control | Query param |
|---|---|---|
| Order no | text | `order_no` |
| Challan | text | `challan_no` |
| Lot | text | `lot_no` |
| Haste | text | `haste` |
| Month | `<select>` — *All months* + every month in the order book, newest first, labelled `Aug 2026 (14)` or `— none` | *(none — it writes From/To)* |
| From date | `Input type="date"`, `max={to}` | `from` |
| To date | `Input type="date"`, `min={from}` | `to` |

**Month is not a filter — it is a shortcut that writes the date range.**
Choosing one calls `set(monthRange(key))`; the select's own value is derived
back from the dates by `monthOfRange(from, to)`. So the two can never
disagree, and a hand-typed range that happens to be a whole month displays as
that month. *All months* clears both dates.

The select is styled by hand (`h-9 w-full rounded-field border
border-line-strong bg-surface px-2 text-sm text-ink`, focus
`border-accent ring-4 ring-[var(--accent-ring)]`) because there is no shared
Select primitive. A **Clear** ghost button appears at the bottom right only
when something is active, and can be suppressed with `showClear={false}` for
screens that render their own.

The panel fires `onChange` on **every keystroke**; each screen debounces before
querying. That is why the debounce lives in the screen, not the panel.

### 3.5 Region C — The table (desktop, `hidden lg:block`)

Inside `<Card data-size="sm">` → `<CardContent className="px-0">` →
`<HScroll bodyClassName="max-h-[calc(100vh-19rem)] overflow-auto">` →
`<table className="w-full min-w-[1240px] text-left text-sm text-ink">`.

Three things are load-bearing:
- **`min-w-[1240px]`** — thirteen columns do not fit; the table scrolls
  sideways inside `HScroll`, which puts a second scrollbar *above* the header.
- **`max-h-calc(100vh-19rem)`** — bounding the body keeps that bottom
  scrollbar on screen instead of stranding it below 200 rows.
- **`THead` is `sticky top-0 z-20 bg-surface`**, and the first column is
  `sticky left-0 z-10` — pinned both ways, so neither the header nor the order
  number is lost while scrolling.

| # | Column | Cell |
|---|---|---|
| 1 | Order no | sticky; chevron toggle + `<Link>` to `/orders/:id`, `font-medium`, hover `text-accent underline` |
| 2 | Date | `.num whitespace-nowrap` |
| 3 | Party | `max-w-[220px] truncate`, `title` = full name |
| 4 | Haste | `max-w-[140px] truncate`, `—` when null |
| 5 | Agent | `max-w-[140px] truncate`, `—` |
| 6 | Fabrics | `max-w-[200px] truncate`, `fabrics.join(", ")`, `title` = the full list |
| 7 | Designs | right, `.num` — active count, or `total_line_count` when the order is CANCELLED; a `+N` in `text-[11px] text-danger` when some (not all) are cancelled |
| 8 | Total Qty | right, `.num` |
| 9 | Total Amount | right, `.num`, `₹` prefixed |
| 10 | Challan | `—` when null |
| 11 | Lot | `—` |
| 12 | Status | `<StatusBadge>` |
| 13 | Actions | right-aligned icon row |

`Td` is local here (not the shared primitive) — `px-3 py-2 whitespace-nowrap`,
spreading `...props` so callers can set `title` for a tooltip on truncated text.

**Cancelled rows.** `cancelled = operations_status === "CANCELLED"` →
`struck = "text-ink-muted line-through"` applied to every data cell **except**
Status and Actions. The row stays; it is never hidden (§3.7).

**Row:** `group border-b border-line last:border-0 hover:bg-surface-2`. The
sticky first cell repeats the hover through `group-hover:bg-surface-2` —
without it the pinned column keeps the resting background and the row appears
to break in two.

**Actions**, all `Button variant="ghost" size="icon-sm"` with an `aria-label`:

| Icon | Action | Gate |
|---|---|---|
| eye | → `/orders/:id` | always |
| pencil | → `/orders/:id/edit` | `orders.edit` |
| route | → `/tracking/:id` | `operations.view` |
| ban / rotate-ccw | Cancel (dialog) / **Restore (immediate)** | `orders.edit` |
| trash | Delete (dialog) | `orders.edit` |

Cancel and Delete are `text-danger hover:bg-danger/10`. **Restore has no
dialog** — it is the undo, and confirming an undo is noise.

### 3.6 Expandable designs panel

The chevron button (`-m-1 rounded p-1`, `aria-expanded`, rotating
`rotate-90`) toggles the id in `expanded`. An open row renders a second
`<tr className="border-b border-line bg-inset/40">` with a single
`<td colSpan={13} className="p-0">` holding `<OrderDesignsPanel orderId caps />`.

`OrderDesignsPanel` (`components/orders/order-designs.tsx`) fetches that
order's lines on demand and renders a `table-fixed` table at `text-[13px]`
inside `rounded-card border border-line bg-surface`:

| Fabric | Design no | Qty | Rate | Line total | Status | Actions |
|---|---|---|---|---|---|---|
| `26%` | `16%` | `10%` right | `10%` right | `14%` right | `14%` | `10%` right |

Per-design **cancel/restore** and **soft-delete** live here, gated on
`orders.edit` (`useDesignActions`). Header cells are `px-3 py-1.5 font-medium
text-[11px] text-ink-muted`.

`OrderDesignsList` is the same data as a stacked card list, used by the mobile
popup — `flex flex-col gap-2`, each row `flex items-center gap-2 rounded-field
border border-line bg-surface p-2`.

### 3.7 Mobile (`lg:hidden`)

`flex flex-col gap-2.5` of `OrderCard` — a full-width `button` at `rounded-card
border border-line bg-surface p-3 shadow-sm`, hover `border-line-strong`,
`active:scale-[.99]`:

- Top row: order no (`num font-semibold text-ink`) over the party
  (`truncate text-[13px] text-ink-soft`), with a `StatusBadge` on the right.
  Both struck through when cancelled.
- Bottom row: `flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-muted` —
  date · `N designs` · `N cancelled` (danger, only when partly cancelled) ·
  `N mtr` · and the amount pushed right with `ml-auto` at `text-[14px]
  font-semibold text-ink`.

Tapping opens the **quick-view dialog**: title = order no (`.num`) +
`StatusBadge`, description = party, then a `grid grid-cols-2 gap-x-4 gap-y-3`
`<dl>` of `DetailItem` — Date · Department · Sales person · Agent · Haste ·
Challan no · Lot no · Designs · *Cancelled designs (only when > 0)* · Total qty
· Grand total · Fabrics (`col-span-2`). `DetailItem` is `dt` at `text-[12px]
text-ink-muted` over `dd` at `font-medium break-words text-ink`, `.num` when
`mono`.

Below that, for editors, a **Manage designs** section (`text-[11px]
font-semibold uppercase tracking-[0.06em] text-ink-muted` heading) wrapping
`OrderDesignsList` in `max-h-[40vh] overflow-y-auto`. The footer repeats View ·
Edit · Track · Cancel/Restore · Delete as small buttons.

**The popup is kept in sync with the list.** An effect finds the fresh row by
id after every refetch and re-`setSelected`s it; if the order has vanished —
its last design was deleted, so the whole order went to Trash — and the query
is no longer fetching, the popup closes itself. Without this, cancelling a
design inside the popup left a stale header above it.

### 3.8 Footer

Only when `visibleRows.length > 0`: `flex items-center justify-between
text-sm` — the count on the left (`N orders` + ` (filtered)` when a KPI filter
is on) and `<Pager>` on the right, rendered only when `totalPages > 1`.

`safePage = Math.min(page, totalPages)` — clamped rather than reset, so a
filter that shrinks the set does not blank the table before the effect fires.

### 3.9 The three empty and error states

All inside `<Card data-size="sm">`:
- Loading: `<Spinner /> Loading orders…`, `py-10 text-sm text-ink-soft`.
- Error: `py-10 text-sm text-danger` with the message, falling back to
  *"Failed to load orders."*
- Empty: `py-10 text-center text-sm text-ink-soft` — *"No orders match this
  filter."* when a KPI filter is on, otherwise *"No orders found for “X”."*

### 3.10 Writes

| Action | Request | Invalidates |
|---|---|---|
| Delete order | `PATCH /api/orders/:id/delete` `{line_id: null, deleted: true}` | `orders`, `order-status`, `trash` |
| Cancel / restore order | `PATCH /api/orders/:id/cancel` `{line_id: null, cancelled}` | `orders`, `order:id`, `order-status`, `tracking:id` |

**The trash icon is a SOFT delete.** It moves every design to Trash — hidden
from lists and operations, stage progress preserved, restorable. Permanent
purge exists only on the Trash screen (§3.8 of `CLAUDE.md`). The dialog says
so in as many words:

> *Delete order **X** and all its designs? They move to Trash (hidden from
> lists and operations) and keep their stage progress. You can restore them
> from Trash anytime.*
> Buttons: **Keep** / **Delete order**.

The cancel dialog reads:

> *Cancel order **X** and all its designs? They stay on record (struck through)
> and are excluded from totals and operations. You can restore later.*
> Buttons: **Keep** / **Cancel order**.

Both buttons show `<Spinner /> Deleting… / Cancelling…` while pending, and
both dialogs `setToDelete(null)` / `setToCancel(null)` on error as well as
success.

### 3.11 CSV export

`exportCsv()` re-fetches with the same params (`all=1`) rather than exporting
the page in hand — the export must carry the whole filtered set, not twenty
rows. Filename `orders-YYYY-MM-DD.csv`. Columns:

`Order no · Date · Party · Haste · Agent · Fabrics · Designs · Cancelled ·
Qty · Total Amount · Challan · Lot · Status`

Fabrics are joined with ` | ` (not a comma — the file is comma-separated).
Designs uses `total_line_count` for a cancelled order and `line_count`
otherwise, matching the table. On success: `Exported N orders.`

---

## 4. Order status — `/order-status`

**Page:** `app/(app)/order-status/page.tsx` — server component; reads
`session.user.caps` and the user's **email as `userKey`** (per-user
localStorage keys), and wraps the screen in `<Suspense fallback={null}>`
because it reads `useSearchParams`. Without the boundary the build fails.

**Components:**
`order-status-screen.tsx` (47) → `order-status-board.tsx` (1,268) or
`order-tracker.tsx` (738) + `tracker-detail.tsx` (512) + `stage-cell.tsx` (66)
+ `quality-groups.ts` + `status-drawer.tsx` (349) + `column-picker.tsx` (180).

This screen is **read-only**. Nothing on it writes; the drawer's footer sends
the user to Operations to make a change.

### 4.1 The switch, and when it is overridden

```ts
const { view, setView } = useTrackView(`oe:order-status:view:${userKey ?? "anon"}`);
const deepLinked = params.get("overall") || params.get("stage") || params.get("cancelled");
const effective = deepLinked ? "table" : view;
```

**A deep link wins over the remembered choice.** Those three params only ever
come from a Dashboard KPI card, and a card that says *Overdue* must land on the
board with that filter applied — not on the tracker, which cannot express it.
`setView` still writes the user's real preference, so the override lasts one
visit.

`ViewSwitch` here labels the second tab **Board** (Orders labels it *Orders*).
`?search=` is forwarded into the tracker as `initialSearch`.

---

## 4A. The Board

### 4A.1 State and the deep-link seeds

| State | Seeded from | Debounce |
|---|---|---|
| `searchInput` → `search` | — | **200 ms**, live (no Enter) |
| `party`, `fabric` | — | — |
| `stage` | `?stage=` | — |
| `overall` | `?overall=` (validated against the three values) | — |
| `cancelledOnly` | `?cancelled=1` | — |
| `filters` → `debouncedFilters` | — | 300 ms |
| `page`, `expanded`, `selectedLineId`, `showFilters`, `exporting` | — | — |

**`cancelledOnly` is separate from `overall` on purpose.** "Cancelled" is not
an `OverallStatus` — a fully cancelled order has no live stages, so its derived
overall is a vacuous `completed`. Folding it into the same variable would make
the Cancelled card select Completed. Setting either clears the other.

An effect resets `page` to 1 on any filter change.

### 4A.2 Everything happens on the server

```ts
useQuery({
  queryKey: ["order-status", { search, party, fabric, stage, overall,
                               cancelledOnly, page, filters }],
  queryFn: () => apiGet(`/api/order-status?${tableParams({ page })}`),
  placeholderData: (prev) => prev,
})
```

The grouping by order, the five KPI counts, the overall/stage/cancelled
refinement **and the pagination** are all done in `lib/order-status-query.ts`.
The board previously asked for every line with `all=1` and rolled ~4,100 of
them up in the browser — a 5 MB response on every filter change. It is now
~500 KB for a page of 20 orders. `all=1` still exists and is used by the CSV
export alone.

The response supplies `groups`, `summary`, `total`, `totalPages` and `page`;
`safePage = q.data?.page ?? page` — the server's answer wins, so a page number
beyond the end corrects itself.

### 4A.3 Region A — Summary cards

`grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5`. All five are filters,
`aria-pressed`, active `border-accent ring-2 ring-[var(--accent-ring)]`.

| Card | Marker | Sets |
|---|---|---|
| Total orders | list-checks icon | `overall=""`, `cancelledOnly=false` |
| In progress | amber dot | `overall="in_progress"` |
| Completed | green dot | `overall="completed"` |
| Overdue | red dot | `overall="overdue"` |
| Cancelled | ban icon | `cancelledOnly=true`, `overall=""` |

**`SummaryCard`** — `rounded-card border bg-surface p-2.5 sm:p-3.5 text-left
shadow-sm`. A label row at `text-[12px] font-medium text-ink-soft` carrying
either a `size-2 rounded-full` tone dot (`bg-success` / `bg-warning` /
`bg-danger` / `bg-ink-muted`) or an icon at `[&_svg]:size-3.5`, then the value
at `num text-[20px] sm:text-[26px] font-semibold text-ink`. `—` when undefined.

These counts are **order-level**. They used to be applied per line on the
server, which is why the board appeared to ignore them.

### 4A.4 Region B — Toolbar

`flex items-center gap-2` — search grows, everything else is `size="icon"` and
`shrink-0`:

- **Search** — `flex-1`, `pl-8`, icon at `left-2.5`. Placeholder *"Search order
  no, party, fabric, design…"*. Live, 200 ms.
- **Filters** — icon button, `aria-pressed`, with a `size-2 rounded-full
  bg-accent ring-2 ring-surface` dot at `-top-0.5 -right-0.5` when any filter
  is active. (The ring is what keeps the dot legible against the button edge.)
- **`ColumnPicker`** — `hidden lg:block`; pointless where the table is hidden.
- **Refresh** — spinner while fetching.
- **Export** — the only **primary** button here; disabled at `total === 0`.

**Filter row** (`flex flex-wrap items-center gap-2 rounded-field border
border-line bg-surface-2 p-2.5`), all `h-9`:

| Control | Options |
|---|---|
| Party `<select>` | *Party: any* + `useLookup("PARTY")` |
| Fabric `<select>` | *Fabric: any* + `useLookup("FABRIC")` |
| Stage `<select>` | *Any stage* + `At: <label>` per stage |
| Challan no | `w-[130px]` |
| Lot no | `w-[110px]` |
| Haste | `w-[110px]` |
| From – To | two `type="date"` at `w-[150px]`, `max`/`min` cross-bound, separated by an en dash |
| Clear | ghost, only when something is active |

Note this board builds its filter row **by hand** rather than using
`OrderFilters` — it needs Party/Fabric/Stage selects that panel does not have,
and it drops the Order-no and Month controls. It still reuses
`OrderFilterState` and `appendOrderFilterParams`, so the query params stay
identical across screens.

**`ColumnPicker`** (`components/order-status/column-picker.tsx`) — a base-ui
`Popover` of checkboxes over `STATUS_COLUMNS`:

```
order (LOCKED) · date · party · haste · fabric · designs · qty · total
challan · lot · sales · stages (7) · overall
```

`useColumnPrefs(key, columns)` persists to
`oe:order-status:cols:<email>`. Two decisions:
- **It stores the HIDDEN ids, not the visible ones** — so a column added in a
  later release defaults to *visible* for existing users instead of silently
  vanishing.
- Persistence is gated on a `loaded` flag set after the first client read, so
  hydration cannot clobber the saved set with an empty one.

Restored ids are filtered against the current toggleable list, so a removed
column leaves no orphan. `order` is `locked` — rendered, disabled, always on.

### 4A.5 Region C — The grouped table (`hidden lg:block`)

`<HScroll bodyClassName="max-h-[70vh] overflow-auto">` around
`<table className="w-full min-w-[1240px] border-collapse text-left text-sm">`.
`<thead>` is `sticky top-0 z-20 bg-surface`; the Order-no header is
`sticky left-0 z-30 bg-surface shadow-[1px_1px_0_var(--line)]` and the body's
first cell `sticky left-0 z-10 … shadow-[1px_0_0_var(--line)]`.

**The shadow is the border.** A sticky cell's own `border-r` scrolls away with
the cell in some engines; a 1 px box-shadow does not. Both sticky cells repeat
the row states through `group-hover:bg-surface-2
group-focus-visible:bg-surface-2`.

Every column except Order no is wrapped in `isVisible("id") && …` — in **both**
the header and the body, driven by the same id list, so a mismatch is
impossible.

| Column | Parent row (order) | Child row (design) |
|---|---|---|
| Order no | chevron + order no, `num font-semibold` | indented `pl-8`, a `-rotate-45` chevron + the **design no** |
| Date | `formatDate(odDate)`, `text-ink-soft` | *(blank)* |
| Party | `max-w-[180px] truncate`, `title` | *(blank)* |
| Haste | `—` | *(blank)* |
| Fabric | the fabric, or `N fabrics` when >1; `title` = all | that line's fabric |
| Designs | `designCount` + `+N` danger hint | *(blank)* |
| Total qty | `formatNumber(qtyTotal)` | that line's `qtyMtr` |
| Total | `₹…` | `₹…` or `—` when `lineTotal` is null |
| Challan / Lot / Sales | value or `—` | *(blank)* |
| Stages (7) | `<StageChip>` folded over the order's lines | `<StageChip>` for that line |
| Overall | `<OverallBadge>` or `<CancelledTag>` | same, per line |

The child row is `bg-surface text-[13px]`; blank cells are still rendered
(`<Td />`) so the columns stay aligned.

**Both rows are activatable.** `role="button" tabIndex={0}`, click or
Enter/Space opens the drawer — the parent on its first line, the child on
itself. The parent's key handler checks `e.target === e.currentTarget` so a
keystroke aimed at the chevron does not also open the drawer; the chevron's
own click calls `e.stopPropagation()`.

**Cancelled:** `struck = "text-ink-muted line-through"` on the identity and
money cells; each stage cell renders a muted `–` titled *Cancelled*, and
Overall renders `<CancelledTag>` instead of the badge.

### 4A.6 The seven stage columns

Header: a `size-1.5 rounded-full` dot in the stage's colour (`STAGE_DOT`) plus
a short name — `Entry · Stock · Rolling · Challan · Bill · Dispatch · LR`
(`STAGE_SHORT`). The full names are long and would set the column width.

**`StageChip`** renders one cell. `StageDot` is the pill:
`num inline-flex min-w-[26px] items-center justify-center rounded-md px-1
py-0.5 text-[11px] font-medium`, toned `bg-success/10 text-success`,
`bg-danger/10`, `bg-warning/10`, or `bg-inset text-ink-muted`.

**Stock checking is special-cased first**, and its gate always wins:

| Condition | Renders |
|---|---|
| `state === "done"` | green check, title `In stock · <date>` |
| mixed (`total > 1`, some in, some out/pending) | inline counts `3✓` green `1✕` danger `2·` muted, title `3 in stock · 1 out of stock · 2 pending` |
| any out of stock | red **Out** |
| otherwise | muted `–` **Pending** |

Other stages:

| State | Renders |
|---|---|
| done | green check, title `Done · <date>` |
| overdue | red `Nd` (or `!`), title *Overdue* |
| in progress, group | amber `3/8`, title `3 of 8 done` |
| in progress, single | amber `•` |
| not started | plain `–` |

**`CurrentStageBadge`** (mobile only) names the bottleneck stage instead:
a stage-coloured dot + the stage label in a pill, tinted amber normally, red
when overdue or out of stock, muted while stock is pending, with a sub-line
underneath (`3 of 8 lines`, `2d late`, `4 of 9 in stock`). No
`currentStageKey` at all ⇒ a green **Completed** pill. Here too the stock gate
is checked **before** the overdue branch, so the cell never reads a date where
it should read *Out of stock* — matching the drawer and the CSV.

### 4A.7 Mobile card (`lg:hidden`)

`OrderStatusCard` — `rounded-card border border-line bg-surface p-3 shadow-sm`,
four bands separated by `border-t border-line pt-2.5`:

1. Order no (`num text-[15px] font-semibold`) over `party · date`
   (`text-[12px] text-ink-soft`), with the overall badge or Cancelled tag right.
2. `grid grid-cols-3` of `Fig` (label `text-[10px] uppercase tracking-[0.04em]
   text-ink-muted` over value `num text-[13px] font-semibold`): Designs ·
   Total qty · Amount.
3. Meta line at `text-[11px] text-ink-muted`: fabric label · sales person ·
   `N cancelled` in danger.
4. **Progress** — `N/7 stages` over a `h-1.5 rounded-full bg-inset` track with
   an `bg-accent` fill at `Math.round(doneCount/7*100)%`, then
   `<CurrentStageBadge aggregate>`. Hidden entirely for a cancelled order.

Tapping opens the drawer on the order's first line.

### 4A.8 The detail drawer

`flatLines = pageGroups.flatMap(g => g.lines)` gives prev/next across the whole
page, not just the open group.

`StatusDrawer` is a centred modal, not a side drawer: a `fixed inset-0 z-50`
scrim (`bg-black/40 backdrop-blur-[2px]`, itself a button that closes) with an
`<aside role="dialog" aria-modal>` at `max-h-[85dvh] w-full max-w-3xl
rounded-card border border-line bg-surface shadow-lg`, animating
`fade-in-0 zoom-in-95 duration-150` under `motion-safe:`.

- **Header** — prev / next icon buttons, then `party · fabric` at `font-display
  text-[15px] font-semibold` over `orderNo · design` at `num text-xs`, a
  Cancelled pill when applicable, and close. While loading, a `h-9` spacer
  holds the height so the header does not jump.
- **Body** — `rounded-card border bg-surface-2 p-4 sm:p-5` holding a
  `grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4` of twelve fields: OD date ·
  Order no · Agent · Haste / Fabric · Design · Qty · Sales person / Challan no
  · Lot no · Department · Remarks. Then a rule and `N of 7 stages complete`.
- **Stage timeline** — a `<ol>` of `TimelineStep`, one per stage, marking the
  `currentStageKey`.
- **Footer** — for `operations.edit`, a full-width **Update in Operations**
  button linking to `/tracking/:orderId`; otherwise the sentence *"Status
  updates happen in Operations (Ops / Admin)."* The drawer itself never writes.

It fetches `GET /api/order-status/:lineId` per line.

### 4A.9 CSV export

Refetches with `all=1` and the same refinement, then flattens to **lines**
(the board groups by order; the export is line-level). Columns:

`Order no · Party · Fabric · Design · Mtr · Sales · OD date ·
<the 7 stage labels> · Done · Overall · Cancelled`

Each stage cell: `cancelled` when the line is; for stock checking `In stock` /
`Out of stock` / `Pending`; otherwise `Done <date>` or the raw state. `Done` is
`N/7`. Filename `order-status-YYYY-MM-DD.csv`.

`csvCell` quotes any value containing `"`, `,` or a newline and doubles inner
quotes. `download()` prepends a **UTF-8 BOM** (`﻿`) so Excel opens party
names and the rupee sign correctly.

---

## 4B. The Tracking view

`components/order-status/order-tracker.tsx`. **Shared, not duplicated** — the
same component is the default view of Orders (§3.1). It answers one question:
*where is this order?*

### 4B.1 The unit is a QUALITY, not a design

`toQualityGroups` (`quality-groups.ts`) rolls each order's lines up by fabric,
keyed `` `${orderId}|${fabric}` ``. An order of 97 lines becomes four rows, not
97. The designs under a quality are its colours.

> **This app has no colour field.** What operators call a colour is
> `design_no` — the DSGN-MATCHING column from the old AppSheet, e.g. `21288-A`
> under `INDIANA CHECKS`.

**Tone** — `toneOfLines(lines)`, over the non-cancelled lines only:

| Tone | Rule | Text colour | Label |
|---|---|---|---|
| `cancelled` | no active lines | `text-ink-muted` | Cancelled |
| `done` | every active line has all stages done | `text-success` | Completed |
| `progress` | any active line has `doneCount > 0` | `text-warning` | In progress |
| `none` | otherwise | `text-danger` | Not started |

A row where everything is cancelled is **not** "not started" — colouring it red
would read as urgent work that does not exist.

**Status is carried by the TEXT colour, never a row background.** Tinting whole
rows was tried and reverted: most work is unfinished, so the screen became a
wall of red with the data buried under it.

`isDispatched(line)` = its `dispatch` stage is `done`.

### 4B.2 Search bar

`flex flex-wrap items-center gap-2`:
- The input is `h-10 w-full pl-9 pr-24`, icon at `left-3`. Placeholder:
  *"Search order no or party name — results update as you type"*. **200 ms
  debounce, no Enter.**
- Inside the right padding sits live feedback: a `size-4` spinner while
  fetching, otherwise `N orders` in `.num`. Without it a slow round trip reads
  as *"nothing happened — do I need to press Enter?"* — which is what the 24 px
  of right padding is reserved for.
- Then the `toolbar` slot (the view switch, and New order on the Orders
  screen), a **Filters** button that turns `variant="default"` while open or
  active, and Refresh.

`OrderFilters` (§3.4, the shared panel) renders below when open — the same
order no / challan / lot / haste / month / date-range controls the Orders table
has. The need for them does not stop at the screen boundary.

### 4B.3 The status key is also a filter

A row of four pills at `text-[11px]` — Completed · In progress · Not started ·
Cancelled — each in its tone colour with the count appended at
`opacity-70`. Clicking one sets `toneFilter`; clicking it again clears it, and
a **Clear** pill appears alongside.

**It filters the page in hand, not the query.** The server paginates by order
and the tones are computed per quality, so it cannot be pushed down. The counts
say how many rows that is.

### 4B.4 The table

`<Card className="min-w-0 overflow-hidden p-0">` wrapping `<HScroll>` around
`<table className="w-full min-w-[1180px] text-left text-sm">`.

**Three pinned identity columns**, by explicit pixel widths so their `left`
offsets can be computed:

```ts
const W_ORDER = 84, W_PARTY = 168, W_QUALITY = 176;
const L_PARTY = W_ORDER;             // 84
const L_QUALITY = W_ORDER + W_PARTY; // 252
```

```ts
const stickyBase = "sticky z-[2] border-r border-line px-2.5 py-2 align-middle";
const stickyCell = `${stickyBase} bg-[inherit]`;   // body: takes the row's tint
const stickyHead = `${stickyBase} z-[5] bg-surface`; // header: opaque outright
```

Body cells use `bg-[inherit]` so the pinned columns keep the row's hover and
selected tint. Header cells are given an opaque background **outright** rather
than inheriting — stacking two background utilities leaves the winner to CSS
source order, and a see-through sticky header is precisely the bug this
solves.

Header: `sticky top-0 z-[4] bg-surface`, row `text-[12px] font-bold
tracking-[0.04em] text-ink uppercase`.

| Column | Notes |
|---|---|
| Order no | pinned, 84 px |
| Party | pinned, 168 px, truncate + `title` |
| Quality | pinned, 176 px, truncate + `title` |
| OD date | |
| Designs | right |
| Mtr | right |
| Sales | |
| Status | plain words, in the tone colour |
| **7 stage columns** | `STAGE_COL_WIDTH = 96` each, centred, `title` = full stage name |

**The table height is measured, not calculated.** A `calc(100vh - Nrem)` cannot
know how tall the header, the wrapping search bar and the legend actually came
out, so it always leaves dead space. Instead a `useLayoutEffect` measures the
card's document-relative top (`getBoundingClientRect().top + window.scrollY` —
against the document, so a scrolled page does not produce a short table),
subtracts `RESERVE = 108` for the pager, the app footer and breathing room,
clamps at 240, and feeds `bodyStyle={{ maxHeight: bodyMax }}`. It re-runs on
`resize` **and** through a `ResizeObserver` on `document.body`, because the
toolbar above changes height when it wraps.

**`StageCell`** (`stage-cell.tsx`) — how far a set of designs has got through
one stage. `num inline-flex min-w-[44px] rounded-pill px-2 py-1 text-[12px]
font-semibold tabular-nums`, toned `bg-success/15` (all done) /
`bg-warning/15` (some) / `bg-danger/15` (any overdue) / `bg-inset` (none).
Text: a single design is a yes/no — `✓`, `!`, `–`; a group gets `✓` or `3/8`.

**Rows.** A quality row is `bg-surface hover:bg-inset`, `bg-accent/10` while it
holds the selection, and carries `data-group-key`. Clicking anywhere selects
its first line; the chevron (`stopPropagation`) expands it into `ColourRow`s —
`bg-surface-2`, `data-line-id`, the design number indented `pl-5` in the
quality column, struck through when cancelled, and `bg-accent/25` while
flashed.

**Groups are collapsed by default.** One row per quality is the point; the
stage cells already answer "how far along?".

### 4B.5 The floating detail panel

Not a sidebar — the table keeps the full width and the panel floats over it, so
nothing is resized and whatever it covers stays reachable by scrolling.

```
fixed z-30 flex max-h-[calc(100vh-8rem)] w-[min(94vw,520px)]
flex-col overflow-hidden rounded-card border border-line-strong
bg-surface shadow-2xl
```
Default position `{ right: 24, top: 104 }`; the first drag switches it to
explicit `{left, top}` coordinates.

**Dragging** — pointer events on the title bar. `startDrag` records the grab
offset, captures the pointer and pins the current rect; `onDragMove` clamps to
`x ∈ [80 - width, innerWidth - 80]`, `y ∈ [8, innerHeight - 48]` so a grabbable
strip always stays on screen. **Double-click the bar snaps it back** to the
default corner.

**Keyboard** (window-level): `Escape` closes. `←` / `→` / `Enter` step
through matches (`Shift+Enter` backwards), wrapping modulo the list — but only
when something is selected and the event target is **not** an
`INPUT|TEXTAREA|SELECT|BUTTON|A` or contenteditable. Never hijack a keystroke
meant for a field.

**The table follows the panel.** An effect on `selectedId` calls
`revealLine(line, false)`, which:
1. sets `expanded` to **exactly one** group — leaving WALNUT open while the
   panel has moved on to Woodland is how the table and the panel start telling
   different stories;
2. waits a `requestAnimationFrame` (the row does not exist until the group has
   rendered);
3. finds `[data-line-id]`, falling back to `[data-group-key]`, and
   `scrollIntoView({ behavior: "smooth", block: "nearest" })`.

The **⌖ button** does the same with `block: "center"` and sets `flashId`,
which tints the row `bg-accent/25` for 1,600 ms — repeated Next clicks walk the
panel far from wherever the page happens to be scrolled, and the eye needs
help finding the row again.

### 4B.6 Panel contents (`tracker-detail.tsx`)

Top to bottom:

1. **Header / drag handle** — a grip icon, the party and quality, `orderNo ·
   design` beneath, prev / `i of n` / next, the ⌖ button, close. Then a
   progress bar: `h-1.5 rounded-pill bg-inset` with the done fraction and
   `N/7` beside it.
2. A danger banner — *"This design is cancelled."* — when applicable:
   `rounded-field bg-danger/10 px-3 py-2 text-xs font-medium text-danger
   ring-1 ring-danger/20 ring-inset`.
3. **Facts** — `grid grid-cols-2 divide-x divide-y divide-line rounded-card
   border bg-surface-2`, two to a row, **in plain ink**: OD date · Order no ·
   Sales person · Quality · Design no · Mtr / yard · Value · Waiting on
   (`currentStage` or *All stages done*), plus Challan no and Lot no **only
   when set**. Deliberately uncoloured so they do not compete with the status
   below. `Fact` is a label at `text-[10px] font-semibold uppercase
   tracking-[0.06em] text-ink-muted` opposite a value at `text-[12.5px]
   font-semibold text-ink`, truncated.
4. **Progress** — the seven stages as an `<ol>` with a connector drawn in the
   completed colour only as far as the work has actually reached. Each row
   shows the stage name, its **due date**, and once done the date, the time and
   how late it ran (`lateness()`, in `text-warning`). Lateness is shown only
   for a *finished* stage — a late finish is a different fact from a stage
   that is merely overdue now.
5. **Whole order** — Qualities · Designs (`+N cancelled`) · Total qty · Total
   value · Dispatched `N/M designs`.
6. **Colours in <quality>** — only when the group has more than one line: the
   dispatched count, then a wrap of `ColourChip`s (✓ dispatched, • not), each
   selecting that line, with the legend *"✓ dispatched · • not yet — click one
   to open it"*.

**The stages come first deliberately.** An earlier version listed agent /
department / haste / entered-on above them and pushed the actual tracking off
the bottom of the panel. Rows that would only ever read `—` are not rendered
at all.

`StageCell` gained `plannedAt` and `delayMinutes` to feed this panel; both were
already computed in `computeStages` but only reached the single-line detail
endpoint.

---

## 5. Operations — `/tracking` and `/tracking/:id`

Two screens. **`/tracking`** is a list of every order, purely to get you into
one; **`/tracking/:id`** is the 7-stage matrix where the work is actually
recorded. This is the only screen in this document that writes stage progress.

- `app/(app)/tracking/page.tsx` → `<TrackingIndex />` (419 lines) — no caps
  needed; the whole route is already gated by `operations.view`.
- `app/(app)/tracking/[id]/page.tsx` → `<TrackingBoard orderId caps />`
  (1,290 lines) — awaits `params` (Next 15 makes them a Promise) and reads
  caps from the session.

### 5.1 The index

Structurally the Orders table with the actions replaced by one **Track**
button, and **server-side pagination** rather than client-side (`page=N`, not
`all=1`) — this list has no KPI cards to keep honest, so there is no reason to
pull the whole set.

- **Search** is `useDebouncedValue(searchInput, 300)` and applies itself; there
  is no submit. Two effects reset the page — one on the debounced filters, one
  on the debounced search (which also sets `search` to the trimmed value).
- Toolbar: search (`sm:max-w-md`), **Filters** (the shared `OrderFilters`, with
  an active dot), **Refresh**, **Export** (primary).
- Table (`hidden md:block`, `min-w-[1040px]`): Order no · Date · Party · Haste
  · Agent · Fabrics · Designs · Total Qty · Total Amount · Challan no · Lot no
  · Status · (Track). **The whole row is clickable** —
  `router.push('/tracking/:id')` — and the action cell calls
  `e.stopPropagation()` so its button does not fire twice. The Fabrics cell is
  the one that wraps: `min-w-[160px] whitespace-normal`.
- Mobile (`md:hidden`): a `<ul>` of cards — order no + `StatusBadge`, party +
  date, then `N designs · N mtr · Challan X · · Haste Y` at `text-[12px]`.
  Tapping opens a dialog (`sm:max-w-md`) with a `grid grid-cols-2` `<dl>`:
  Order no · Order date · Challan no · Lot no · Designs · Total qty · Haste ·
  Agent · Party (`col-span-2`) · Fabrics (`col-span-2`), and a **Track
  workflow** button.

  The dialog exists because a phone cannot show thirteen columns, and tapping
  straight through to the board skips the "is this the right order?" check.
- `Pager` (`justify-end`) when `total_pages > 1`, driven by the server's
  `data.page`.
- CSV: `operations-YYYY-MM-DD.csv`, the same twelve columns minus Cancelled.

**Every order is trackable the moment it is entered** — challan and lot are
optional and are not a precondition.

### 5.2 The board — what it is

`GET /api/orders/:id/tracking` returns the order, `stage_keys` (the seven, in
order, from `workflow_stages`), and one row per line item with its seven
stages. The board renders **one row per active line × seven stage columns**.
Cancelled and deleted lines never appear (`active = lines.filter(l =>
!l.is_cancelled)`; deleted ones are already excluded server-side).

Header: a back arrow to `/tracking`, the order no at `font-display text-lg
font-semibold tracking-[-0.02em]`, the order-level `StatusBadge`, and on the
right `haste · order_date`.

Empty state: *"This order has no active line items to track."*

### 5.3 Cell state — the whole visual language

```ts
type CellState = "done_ontime" | "done_late" | "live" | "overdue"
               | "out_of_stock" | "locked" | "pending";
```

`cellState(stage, key, orderEntryDone, stockInStock)`:

1. `is_done` ⇒ `delay_minutes > 0 ? "done_late" : "done_ontime"`.
2. stock checking with `stock_status === "out_of_stock"` ⇒ `"out_of_stock"`.
3. editable? — `order_entry` **always**; `stock_checking` once order entry is
   done; every other stage once **stock is In stock**. Not editable ⇒
   `"locked"`.
4. otherwise `planned_at < now` ⇒ `"overdue"`, else `"live"`.

| State | `CELL_TONE` | Label |
|---|---|---|
| `done_ontime` | `border-success/30 bg-success/5 text-success` | Done |
| `done_late` | `border-warning/40 bg-warning/5 text-warning` | Done |
| `live` | `border-accent/40 bg-accent/5 text-accent` | Live |
| `overdue` | `border-danger/40 bg-danger/5 text-danger` | Overdue |
| `out_of_stock` | `border-danger/40 bg-danger/5 text-danger` | Out of stock |
| `locked` | `border-line bg-surface-2 text-ink-muted` | Locked |
| `pending` | `border-line bg-surface-2 text-ink-soft` | Pending |

**The cell tint IS the status.** Planned and actual dates are not printed in
the cell — they live in the `title` tooltip:
`<label> — <state> · Plan: <date> · Actual: <datetime>`.

**A legend is therefore mandatory**, and `LegendChips` renders it above the
grid on desktop and inside the summary card on mobile: a `size-3 rounded-[4px]`
swatch per state (`LEGEND_SWATCH` — deliberately stronger, `/20` fills against
the cells' `/5`, because a chip that small needs the extra saturation) plus its
label, with the explanation on hover. Six entries: Done · Done late · Live ·
Overdue · Out of stock · Locked. `pending` has no chip — an untinted cell needs
no key.

### 5.4 The desktop matrix

`<Card data-size="sm" className="hidden lg:block">` → legend strip →
`<HScroll bodyClassName="max-h-[72vh] overflow-auto">` → a `border-collapse`
table. `<thead>` `sticky top-0 z-20`; the Quality column sticky `left-0 z-30`
in the head and `z-10` in the body, both with
`shadow-[1px_0_0_var(--line)]` as their right border.

Fixed columns: **Quality** (sticky, `px-4`) · **Design** (`.num`) · **Qty**
(right, `N mtr`) · **Status** (a `StatusBadge` over `N/7 done` at
`text-[11px]`). Then one column per `stage_key`, each headed by a `size-2`
stage dot in the stage's colour and the label from `workflow_stages` — so
renaming a stage in Settings renames it here.

**Stage dot colours** (`STAGE_DOT`): order_entry indigo · stock_checking blue ·
rolling_checking amber · challan rose · bill emerald · dispatch violet ·
received_lr cyan.

Rows are `border-b border-line align-top`.

**`StageCell`** — every cell is one fixed box:
```
flex h-10 w-full min-w-[164px] items-center gap-1.5
rounded-[10px] border px-2 transition-colors
```
Fixed height and a floor width so the grid stays uniform whether or not a cell
carries a delay pill — the pill sits **inline beside the label, never on a
second line**. Disabled-and-not-done cells (except out-of-stock) get
`opacity-70`.

- **Non-stock stages: the whole cell is the toggle.** A `<button
  aria-pressed={done}>` holding a `CheckBox` indicator (a styled `<span>`, not
  a real input, so the button owns the click), the state label at `text-[11px]
  font-medium text-ink`, an optional pill, and pushed right by `ml-auto` the
  pending dot and a `LockIcon` when locked.
- **Stock checking is a 3-way `<select>`** — *Pending* (`""`) / *In stock* /
  *Out of stock* — `h-6 w-[92px] text-[11px]`. It cannot be a toggle: three
  outcomes, and only `in_stock` counts as done.
- **`DelayPill`** — `num rounded-pill px-1.5 py-0.5 text-[10px]`, amber when
  late (`bg-warning/15 text-warning`), shown only on a done stage with
  `delay_minutes > 0`. Out of stock shows a red **Blocked** pill instead.
- **Pending dot** — `size-1.5 rounded-full bg-accent/50 animate-pulse` under
  `motion-safe:`, per cell, while that cell's request is in flight.

**Which cells are editable** is computed independently of `cellState` in
`LineRow`, with one addition: `stockInStock || stage.is_done` — **a done cell
is always un-tickable**, even if the gate has since closed. Un-ticking is never
blocked (§6).

### 5.5 Header check-all per column

Each stage column except stock checking carries a header checkbox (editors
only), with `indeterminate` set through a ref when some but not all are done.
While that column is being written it becomes a spinner (`columnPending`).

**`columnState(stageKey)` measures over "in play" lines, not every line** —
a line counts if it *can* complete this stage now, or already has. Measuring
over all lines means an out-of-stock line (which can never complete a
post-stock stage) puts "all done" permanently out of reach, so the header box
never shows checked and clicking it can only ever mark-done, never un-check.

**`toggleColumn`:**
- marking done — skip lines already done; include lines where the cell is
  editable; **count the rest as `skipped`**;
- un-marking — include every line currently done for that stage;
- nothing to do ⇒ an error toast naming the fix: *"Skipped N — set stock to In
  stock first for those lines."*;
- otherwise fire them with `Promise.all`, then invalidate `tracking`, `orders`
  and `order:id`. On partial success: *"Updated N; skipped M (stock not In
  stock)."*

**Stock checking has no check-all** — it is a per-line decision with three
outcomes, and a bulk "everything is in stock" is not a claim a header checkbox
should make on the operator's behalf.

### 5.6 Optimistic writes

`PATCH /api/tracking/stage` with `{line_item_id, stage_key, checked,
stock_status}`. The mutation is fully optimistic:

- **`onMutate`** — increment an `inFlight` ref, add `"lineId:stageKey"` to
  `pending`, **`cancelQueries`** so an in-flight refetch cannot clobber the
  write, snapshot the cache, then apply `applyOptimisticToggle`.
- **`onError`** — restore the snapshot and toast the message. The server
  returns **409** with a sentence for any rule violation (`WorkflowError`,
  cancelled line, deleted line), so the toast is already human-readable.
- **`onSettled`** — decrement, drop the pending key, and **reconcile only when
  `inFlight.current === 0`**. One refetch for a burst of clicks, and no refetch
  landing mid-edit — which would flicker.

**`applyOptimisticToggle` mirrors the server exactly**, because
`lib/workflow.ts` is server-only (it pulls in the DB pool) and cannot be
imported into a client component. So `lineStatusOf`, `orderStatusOf` and
`optimisticDelay` are deliberate client mirrors:

- `lineStatusOf` — all done ⇒ COMPLETED; any of the **five post-stock stages**
  (`rolling_checking`, `challan`, `bill`, `dispatch`, `received_lr`) done ⇒
  PARTIALLY COMPLETED; else PENDING. Entry + stock alone is *not* partial.
- `orderStatusOf` — all COMPLETED ⇒ COMPLETED; all PENDING ⇒ PENDING; else
  PARTIALLY. Computed over non-cancelled lines only.
- `optimisticDelay` — `round((now - planned)/60000)`, matching the server's
  `computeDelayMinutes` with `actual = now`, so the delay pill is right the
  instant it is clicked.

> If the server's rules change, these three change in the same commit. They are
> the one place this app knowingly duplicates `lib/workflow.ts`.

### 5.7 Two confirm dialogs — the ones that carry the business rule

**Reverting stock while later stages are done** (`requestStock`). If the new
status is not `in_stock` and any stage after stock checking is done, a dialog
first:

> **Change stock status?** — *<quality · design>* already has stages completed
> after stock checking. Marking stock as *Out of stock / Pending* keeps those
> stages completed, but this line will be flagged **Partially completed**.
> **Cancel** / **Change stock**

**Un-checking a stage while later stages are done** (`requestToggle`). Only on
`checked === false`:

> **Un-check <stage>?** — *<quality · design>* still has later stages marked
> done — *<their labels>*. Un-checking *<stage>* leaves those done, so this
> line stays **<resulting status>**.
> **Cancel** / **Un-check anyway**

The resulting status is computed, not guessed — `lineStatusOf` is run over the
line with that one stage flipped, so it correctly says PENDING when only stock
was done and PARTIALLY when a post-stock stage is.

**Neither dialog blocks the action.** There is no cascade: later stages stay
done and the line simply drops to PARTIALLY COMPLETED. An earlier version
auto-cleared them and was reverted — silently undoing work an operator
recorded is worse than an inconsistent-looking row.

### 5.8 Carry-forward on the first row

Setting the **first row's** stock to *In stock* calls `carryStockInStock()`,
which applies In stock to every other line that is:
- not already in stock, **and**
- not explicitly `out_of_stock` (an explicit Out is never overwritten), **and**
- past order entry.

Toast: *"In stock applied to N lines."* (only when N > 1). Any other row's
dropdown affects only itself. This is the common case — one order, all fabrics
in stock — and it saves a click per line without ever silently reversing a
decision someone made.

### 5.9 Mobile (`lg:hidden`)

No horizontal scrolling at all. Three parts:

1. **Summary card** — `N designs · Lot X · Challan Y · Haste Z` at
   `text-[12px]`, then the legend below a rule.
2. **Fabric selector** — `grid grid-cols-2 sm:grid-cols-3` of buttons, one per
   line: quality (truncated) over `design_no · 3/7`. Complete lines go
   `border-success/40 bg-success/10 text-success` **with a check icon**, the
   selected one `border-accent bg-accent/10` + `ring-2 ring-inset`. So the
   selector doubles as an at-a-glance progress overview.
3. **`MobileLineCard`** — the selected line only: quality + `design · N mtr`,
   its `StatusBadge` and `N/7 done`, then the seven stages **stacked
   vertically** as `MobileStageRow`s. Each row is the same `CELL_TONE` box at
   `flex-col gap-1.5 p-2.5`: a stage dot + label, the state and checkbox on the
   right, and — unlike desktop — the dates printed underneath
   (`Plan <date>` / `Actual <datetime>`) rather than hidden in a tooltip.
   There is no hover on a phone.

**Auto-advance.** When the open fabric goes from incomplete to complete, the
selector jumps to the next incomplete line. Two guards make this safe: it fires
only on that transition for the *currently open* line, and only when
`lastToggledLineId` says **this user's tap** caused it — so a background
refetch reflecting someone else's edit never yanks the screen away from
somebody reviewing a finished fabric.

The effect sits **above the early returns** for the rules of hooks; it reads
`tracking.data` defensively for that reason.

---

## 6. Settings — `/settings`

**Page:** `app/(app)/settings/page.tsx`. It reads the session role and
**`redirect("/")` for anyone who is not ADMIN**, before rendering anything.
The middleware already gates the route; this is defence in depth, and it is
cheap. Caps are passed through only because the Trash tab needs them.

**Shell:** `components/settings/settings-view.tsx` — 85 lines, and it does one
thing: a tab strip over seven panels. **There is no routing here** — the tab
is `React.useState`, so a refresh returns to Dropdown Master and a tab cannot
be linked to. That is a deliberate simplification, not an oversight.

```
Dropdown Master · Design Database · Time tracking · CRM · Users · Access · Trash
```

**Tab strip:** `flex flex-wrap gap-1.5 rounded-field border border-line
bg-surface-2 p-1.5`; each tab `inline-flex items-center gap-2 rounded-[8px]
px-3.5 py-2 text-sm font-medium` with a `size-4` icon, active
`bg-surface text-ink shadow-sm`, inactive `text-ink-muted hover:text-ink`.
Icons: list · database · timer · headset · users · shield-check · trash.

The strip is `<Reveal index={0}>` and the panel `<Reveal index={1}>`.

The **Trash** tab renders `components/trash/trash-view.tsx` — the same
component the standalone `/trash` route uses. Trash is nested under Settings in
the nav but surfaced top-level for a non-admin editor who cannot see Settings
(`visibleNav`, `lib/rbac.ts`).

### 6.1 Dropdown Master

`components/settings/dropdown-master.tsx` (537). Layout
`grid gap-5 lg:grid-cols-[1fr_360px]` — the list, and a bulk-import card beside
it.

**Six category pills** (`rounded-pill border px-3 py-1.5 text-[13px]`, active
`border-accent bg-accent-soft text-accent`): Party · Fabric · Agent ·
Transport · Haste · Sales person. Switching one resets the edit target, the
search, the selection and the bulk-confirm state — every one of those refers to
rows that no longer exist.

Then, top to bottom:
1. **Add form** — an input placeholdered `Add a <Category>…` and an **Add**
   button. `POST /api/lookups`; a duplicate returns **409** (the unique index
   `uq_lookup_values_category_value`) and toasts.
2. **The CRR explainer**, shown only for **Party and Haste**
   (`CRR_LINKED_CATEGORIES`), in `rounded-field border bg-surface-2 px-3.5
   py-3 text-[13px] leading-relaxed`. It says, in the operator's language, that
   *In CRR* means SCOT attributes those orders automatically, *not in CRR*
   means somebody matches it once, the order saves either way, and **nothing
   here needs correcting** — because the temptation on seeing a grey tag is to
   "fix" the spelling, which is exactly what §7 forbids.
3. **Filter values…** — a plain client-side filter over the loaded list.
4. **Bulk bar** (only with rows) — a select-all checkbox with `indeterminate`
   set by ref, the count, and a two-step *Delete N permanently?* confirm
   inline. There is no dialog; the bar becomes the confirmation.
5. **The list** — `<ul className="divide-y divide-line">` inside
   `overflow-hidden rounded-field border`. Each row: a checkbox, the value
   (struck and muted when inactive), the **In CRR** / **not in CRR** pill
   (Party and Haste only, each with an explanatory `title`), an **inactive**
   pill, then Edit · Deactivate/Reactivate. A selected row is
   `bg-accent-soft/50`.

**Edit and delete are inline row states, not dialogs** — `editId` swaps the
label for an input plus tick/cross; `confirmId` swaps it for *Delete "X"
permanently?* plus Delete/Cancel.

**Deactivate ≠ delete.** `DELETE /api/lookups/:id` deactivates (the value stops
being suggested but every order that used it is untouched); `?hard=1` really
removes the row. The **X** button is deactivate; permanent deletion always
takes the confirm step.

**Bulk import** — a textarea (one value per line, placeholdered
`Value one\nValue two\nValue three`) posting to `/api/lookups/bulk`, which uses
`onConflictDoNothing`. It reports `added / reactivated / skipped`.

### 6.2 Design Database

`design-db.tsx` (327). A browsable history of every fabric+design ever used —
the source of the New-order design autocomplete.

- Search (`order no, fabric, design`, **submit-based**) + Refresh, server
  paginated with `Pager`, table inside `HScroll`.
- Columns: a select-all checkbox · Date (`formatDateTime(created_at)`) · Order
  no · Fabric (`min-w-[160px]`) · Design no · a per-row delete.
- Bulk bar appears with a selection: *N selected*, Clear, **Delete selected**,
  then a two-step *Delete permanently?* → `POST
  /api/design-database/bulk-delete`. Selected rows are `bg-accent-soft/60`.

Deletion here is **permanent** — this table is a log, not a lifecycle. It is
not touched by cancel or soft-delete, and removing a row only removes a
suggestion.

### 6.3 Time tracking (the SLA)

`time-tracking.tsx` (177). `grid gap-5 lg:grid-cols-[1fr_360px]` — the editor
and a **live preview**.

Seven rows, one per stage, each `flex items-center gap-3 rounded-field border
bg-surface-2 px-3 py-2`: a `size-7 rounded-[8px] bg-accent-soft text-accent`
chip carrying `sort_order`, the stage label, and a `num h-9 w-20 text-center`
number input. Header hint: *"days from order date"*.

Local edit state is a `Record<stage_key, string>`, re-seeded from the query
whenever it changes. `changed` compares numerically and ignores an empty box,
so the **Save (N)** button counts only real edits and is disabled at zero.
Saving `PATCH`es each changed stage **sequentially** (a `for` loop with
`await`, not `Promise.all`) — seven writes is well inside the pool budget but
the loop keeps it that way by construction.

**Live preview** — for an order dated *today*, each stage's planned date
rendered as `Mon, 05 Sep` (`Intl.DateTimeFormat("en-IN", {weekday, day,
month})`), `—` while a box is empty or NaN. It reads the **edited** values, so
it moves as you type.

**Two buttons, two meanings:**
- **Save** — *"Time tracking saved. Applies to new orders."*
- **Recompute open orders** — `POST /api/stages/recompute`, which re-dates
  **not-yet-done** stages only. *"Recomputed planned dates for N open stages."*

> ⚠️ **Done stages can never be repaired.** `delay_minutes` is frozen at tick
> time against `order_date + planned_offset_days`, and the recompute skips done
> rows by design. This is why `system_on_time` reads 0 / 70 on real data and
> why five of the seven offsets sitting at the seed default of 1 day was
> unrecoverable history. See `db/analyse-sla.ts`; the live config now stands at
> p75 — entry/stock/rolling/challan 8, bill 10, dispatch 12, LR 12.

### 6.4 CRM

`crm-settings.tsx` (535). Two bands.

**Band 1** — `grid gap-5 lg:grid-cols-[1fr_360px]`: the four knobs, and a plain
English explanation of them.

| Field | Label | Hint | Range |
|---|---|---|---|
| `transit_days_default` | Transit days | Days after dispatch before we assume the goods landed, when no LR is ticked | 0–60 |
| `followup_due_days` | Call within | Days after delivery that a follow-up is due. *A call three weeks later gets nothing useful.* | 0–60 |
| `max_attempts` | Attempts before unreachable | Failed attempts before UNREACHABLE. Reopenable. | 1–10 |
| `escalate_rating_at` | Escalate at rating | At or below this, flag for principal review | 1–5 |

Each is `flex items-start gap-3 rounded-field border bg-surface-2 px-3 py-2.5`
— label and hint on the left, a `num h-9 w-20 text-center` input on the right.
Then **Create follow-ups automatically**, a `Segmented` On/Off, whose hint says
what Off does *not* do: *"Off pauses new follow-ups. Nothing already created is
deleted, and the queue keeps working."* **Save (N)** counts dirty fields.

The side card, **What these change**, restates the rules with the *edited*
numbers substituted live — when a follow-up is created, when it is due, when it
goes unreachable, when it escalates — plus the one thing an admin cannot see
from the form: *"Changing transit days re-dates future follow-ups only.
Anything already in the queue keeps the delivery date it was created with, so
the coordinator's list does not reshuffle under them."*

**Band 2** — `grid gap-5 lg:grid-cols-2`, four managed vocabularies:

| Panel | Source | Note |
|---|---|---|
| **Rating criteria** | `crm_rating_criteria` via `/api/crm/rating-criteria` | label + hint, reorderable with move up/down (`sort_order`), **deactivated, never deleted** — a retired criterion still appears on any call that scored it |
| **Complaint categories** | `lookup_values("CRM_ISSUE")` | *"A coordinator can also type a new one mid-call — it is saved here automatically and offered to everyone from the next call onward."* |
| **Departments** | `CRM_DEPT` | shown as *"Whose to fix"* on the call panel and issues board |
| **Delay reasons** | `CRM_DELAY_REASON` | offered when a customer says it did not arrive on time |

The three list panels are one shared `ManagedList` component (category, title,
placeholder, blurb) writing through the ordinary `/api/lookups` endpoints.

> **What is NOT configurable, and why.** Severity, attempt outcomes and reorder
> intent stay fixed in code: `HIGH` drives escalation in three places,
> `isReachedOutcome()` drives the follow-up state machine and the
> `contacted_at` stamp, and the analytics count specific reorder values. Making
> them data would let a rename silently switch off escalation (`CLAUDE.md`
> §12.4c).

### 6.5 Users

`users-manage.tsx` (477). `grid gap-5 lg:grid-cols-[1fr_340px]` — the list and
an **Add user** form.

Desktop table (`min-w-[620px]`, inside `HScroll`): **User** (name or the
email's local part, an accent **you** pill on your own row, the email
underneath at `text-xs text-ink-muted`) · **Role** (a select over `ROLES`) ·
**Status** (an active/inactive toggle) · **Actions** (rename, reset password,
delete). Mobile is the same four controls as stacked cards
(`rounded-field border bg-surface-2 p-3`) — the row helpers `nameEditor()`,
`roleSelect()`, `statusToggle()` and `userActions()` are shared by both, so the
two renderings cannot drift.

`isSelf` disables the controls that would lock you out of your own account.
Renaming is an inline editor; deleting is a two-step confirm; resetting takes a
new password inline (`placeholder="New password"`) — **there is no self-serve
reset**, which is why the login screen's "Forgot password?" points at an admin.

**Add user** — Email (`person@company.com`) · Full name · Role (default
`VIEWER`) · Password (`At least 8 characters`, enforced before submit).
`POST /api/users`. Google-only users have a null `password_hash` and are never
auto-provisioned — Google sign-in is restricted to **existing active users**.

### 6.6 Access

`access-control.tsx` (235). The Role × Capability matrix, written straight
through: **every checkbox is a `PUT /api/access` on change** — no save button,
no local draft.

- Desktop (`hidden md:block`): a table, Role down the side and the capabilities
  across, each header carrying its `hint` as a `title`. **ADMIN is the first
  row and is hard-coded** — checked, `readOnly`, `disabled`, `opacity-60`, with
  *"Always full access"* beneath the name. It is never stored and never
  editable, so an admin cannot lock themselves out.
- `EDITABLE_ROLES` follow. Checkboxes are `size-5 accent-[var(--accent)]`,
  disabled while a write is in flight, each wrapped in a `label … p-2` so the
  tap target is the whole cell.
- Mobile (`md:hidden`): one section per role, capabilities as label/checkbox
  rows — the same data, no horizontal scroll.
- A footer line, always visible: *"Changes take effect on the user's next
  sign-in. Settings & user management stay ADMIN-only and can't be granted
  here."*
- A second card, **What the capabilities mean**, lists each capability's label
  and hint in a `grid sm:grid-cols-2`.

**Two things to get right when adding a capability:**
1. Capabilities are resolved into the **JWT at login**, so a change applies on
   the user's next sign-in. The footer says so because otherwise the admin
   ticks a box, the user sees no change, and the box looks broken.
2. `capsForRole` falls back to `DEFAULT_ROLE_CAPS` only when a role has **zero**
   stored rows. A new capability on an existing role is therefore *not* granted
   by the code defaults — `/api/access` merges per-cell with the defaults and
   would show the box ticked while the JWT lacks it. **The migration must
   insert every `(role, capability)` pair explicitly, including the denials.**

---

## 7. Things that will bite you

Collected from what actually went wrong building these screens.

1. **Never fan out more than 4 concurrent queries.** `lib/db.ts` caps
   postgres.js at `max: 5`, and the Supavisor transaction pooler does not queue
   the surplus — it stalls for minutes or dies with `CONNECTION_CLOSED`. The
   pool is process-wide, so one endpoint wedging it leaves *every* screen in
   that process stuck on "Loading…". `lib/dashboard-query.ts` fans out in waves
   of ≤4; any new endpoint must too.
2. **Stop the dev server before `npm run build`.** They share `.next`, and
   static generation opens its own connections against the same pool. It fails
   on a *different arbitrary page each run*, and names an impossible cause
   (`uniqueIndex is not defined` in a file that is correct). `rm -rf .next`,
   nothing else running.
3. **Filter `is_deleted = false` on every read path**, and
   `is_cancelled = false` on totals and status. A fully-deleted order drops out
   of the Orders list via `EXISTS(non-deleted line)` so pagination stays
   correct.
4. **Never write `line_total`** (generated) and never store an order grand
   total (derived). Never store an order-level cancelled or deleted flag —
   both are derived from the lines.
5. **`order_no`, `quality`, `design_no`, `challan_no`, `lot_no` are text.**
   Never `parseInt`/`Number()` them.
6. **Party names go out verbatim.** Trimming is the only permitted change, at
   entry. Never rename a party on existing orders — SCOT's alias table is built
   from the raw historical spellings, and a tidied name arrives as a new
   customer.
7. **Autocomplete lists are keyed by position, not by value.** Free-text
   lookups can contain duplicates (they did, from three directions), and a
   value-keyed `<li>` crashes React with *"two children with the same key"*.
8. **`GET /api/lookups` returns `string[]`** unless you pass `?all=1`, which
   returns rows. Typing it wrong yields `[undefined]` and a crash on mount.
9. **`localStorage` reads belong in an effect**, never in render — and always
   inside `try/catch`. A private window throws on access, and a value read
   during render differs between server and client.
10. **Persisting to `localStorage` needs a ready flag that is state, not a
    ref** (§2.13) — a ref is already true in the restore's own commit and the
    persist effect overwrites the saved value with the blank one.
11. **A sticky cell's `border-r` can scroll away; a `box-shadow` cannot.** Use
    `shadow-[1px_0_0_var(--line)]`. And give sticky *header* cells an opaque
    background outright — do not let it inherit.
12. **Store hidden column ids, not visible ones**, so a column added later
    defaults to visible rather than vanishing for existing users.
13. **Measure, don't `calc()`, when a table must fill the viewport** — a
    wrapping toolbar makes any hard-coded offset wrong. Watch `document.body`
    with a `ResizeObserver`.
14. **Client mirrors of server logic must be labelled as such** and changed in
    the same commit (§5.6). `lib/workflow.ts` is server-only.
15. **Break ties deterministically.** Equal dates previously fell out in
    database row order and lists reshuffled between loads.
16. **`null` and `0` are not the same number.** An unrated queue reports
    `null`, never `0.0` — a zero reads as *"they scored us zero"*.
17. **When you edit a table with a script, assert on the replacement.** Two
    silent no-op replaces once left 11 `<Th>` over 9 `<Td>`; the fix was to
    count the tags, not to read the diff.
