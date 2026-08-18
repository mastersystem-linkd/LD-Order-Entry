# LD Order Entry → SCOT: order feed

Handover note for the SCOT team. Everything asked for in the SCOT alias guide
(§4 and §6) is live.

---

## 1. Endpoint

```
GET https://ld-order-entry.vercel.app/api/export/orders
```

Auth: header `x-api-key: <the key sent to you separately>`

The key is SCOT's alone — the Embroidery System uses a different one, so either
can be rotated without disturbing the other. Missing or wrong key → `401`.

## 2. Query parameters

| Param | Default | Notes |
|---|---|---|
| `updated_since` | — | ISO timestamp. **Inclusive** — the boundary record may repeat, so dedupe on the stable ids. |
| `page` | 1 | |
| `limit` | 100 | max 500 |

Ordering is `(updated_at ASC, id ASC)`, so incremental paging is stable.

## 3. Response

```json
{
  "data": {
    "orders": [
      {
        "id": "3f2a…",                          // stable UUID — your external_ref
        "order_no": "LKD-08-25-003",            // user-entered, unique
        "order_date": "2026-08-11",
        "party_name": "SOLID GARMENTS",          // see §5
        "party_name_as_entered": "SOLID GARMENT",// null when unchanged
        "crr_customer_id": 18077,                // null when unresolved
        "haste": null,                           // "through / care of" party
        "sales_person": "Amit Shah",
        "department": "LD",
        "updated_at": "2026-08-11T09:14:22.101Z",
        "line_items": [
          {
            "id": "9c81…",                      // stable UUID, line level
            "quality": "Cotton",                // the fabric
            "design_no": "D-114",
            "qty_mtr": "50.00",                 // metres
            "rate": "155.00",
            "line_total": "7750.00",            // = qty_mtr * rate, your "amount"
            "is_cancelled": false,
            "is_deleted": false,
            "operations_status": "PARTIALLY COMPLETED"
          }
        ]
      }
    ],
    "page": 1, "limit": 100, "total": 222, "total_pages": 3
  }
}
```

### Coverage of your §4

| You asked for | Field |
|---|---|
| `order_id` / `order_no` | `id`, `order_no` |
| `party_name` verbatim | `party_name` |
| `order_date` | `order_date` |
| quality / fabric / design | `quality`, `design_no` |
| qty (+ unit) | `qty_mtr` (metres) |
| `rate` | `rate` |
| `amount` | `line_total` |
| `updated_at` | `updated_at` |
| `customer_id` (CRR) | `crr_customer_id` — **now supplied**, see §6 |

## 4. Things to know

- **`qty_mtr`, `rate`, `line_total` are strings**, not numbers, so exact decimal
  precision survives the wire. Parse as decimal, not float.
- **`line_total` is a generated column** (`qty_mtr * rate`), computed by
  Postgres. It is null when no rate was entered.
- **Cancelled and deleted lines are emitted, not hidden**, flagged
  `is_cancelled` / `is_deleted`. Deleted means "entered in error, moved to
  trash"; cancelled means "customer cancelled it, kept on record". Both are
  reversible on our side, so a line can flip back to `false` in a later pull.
  **Exclude both from revenue.**
- `operations_status` is our internal 7-stage progress
  (`PENDING` / `PARTIALLY COMPLETED` / `COMPLETED`). Ignore it if not useful.
- An order whose lines are all deleted still appears in the feed, with every
  line flagged — that is how you learn to remove it.

## 5. Names are verbatim — as you asked

`party_name` is free text typed by the operator and is passed through
**completely untouched**: no trimming, no case folding, no suffix expansion. Our
export code and both internal docs record this so nobody "cleans" it later.

We checked our list against your canonicalisation rules: **1,709 party values,
1,695 distinct companies** — so 14 near-duplicate pairs. Only **2 orders** in the
whole system use a value from any of those pairs, and in both cases the other
spelling is unused, so no customer's history is split across two strings. Your
alias layer absorbs all 14 anyway (`FOCUS LIFESTYLE` vs `FOCUS LIFESTYLE PVT LTD`,
etc.). We deliberately did **not** merge them, per your Rule 2.

## 6. Two open items from our side

**a) We ARE now sending `crr_customer_id` — for the orders where we know it.**

You sent us the CRR alias export (5,974 aliases, 4,909 customers). We ran your
`scot_canon` rules over it against our live data. The results matter for your
planning:

| Matching method | Our party names | **Our orders** |
|---|---|---|
| Exact alias hit | 33.3% | — |
| `scot_canon` **as specified** | **41.5%** | **37.4%** |
| + internal punctuation folded, `CO` = `COMPANY` | 52.4% | 50.0% |

So `scot_canon` as written resolves **about 37% of our orders**, not the ~98%
your document reports for the CRR↔Tally path. That figure holds where both sides
descend from the same Tally export. Our names were typed independently by
operators, so they diverge in ways your canon does not currently fold.

**The single biggest fixable cause is spacing around initials:**

| Ours | CRR has | `scot_canon` result |
|---|---|---|
| `R. K. FASHION` | `R.K.FASHION` | ✗ no match |
| `G.C. TRADING CO.` | `G.C.TRADING CO.` | ✗ no match |
| `L. J. CLOTHING` | `L.J.CLOTHING COMPANY` | ✗ no match |
| `A K AGENCY` | `A.K.AGENCY` | ✗ no match |

Your canon collapses *runs of whitespace* but keeps spaces adjacent to dots, so
`R. K.` and `R.K.` stay distinct. **Folding internal punctuation would lift you
from 37% to 50% of orders on our feed alone.** (`CO`/`COMPANY` is the other
half of that gain — we understand why you don't strip it, but here it costs
real matches.)

The remaining ~50% are genuine review-bucket cases under your Rule 5:

- **shortened forms** — we write `PR EXPO`, CRR has `PR EXPO TRADELINK LLP`
- **singular/plural** — `SOLID GARMENT` vs `SOLID GARMENTS`
- **typos on both sides** — `OVERTAKE`/`OVARTAKE`, `MAHADEVSAO`/`MAHADEOSAO`
- **genuinely new customers** — `BRANDS AND BOOTS PVT LTD`, `VIN SQUARE`

**What changed.** You sent us the alias export, so we loaded it and did the
resolution on our side. `crr_customer_id` is now on every order we could resolve
**deterministically** — exact spelling, your canon rules, or those two extra
folds. **118 of 222 orders (53%) carry an id today.**

**Read a null as "we don't know", not "no such customer."** We never guess. A
name resolving to two customers is left null, and so is anything the three rules
don't reach. Roughly 21% of our parties genuinely aren't in the export you sent —
some are large firms (`RAYMOND LIFESTYLE LIMITED`), which makes us suspect **the
export may be partial**. Worth checking on your side.

**Two more fields you now get:**

- **`party_name_as_entered`** — where we normalised a spelling to CRR's, this is
  what the operator originally typed. Null when the two are the same. Your Rule 2
  asked to be told about renames; this is us telling you, per order.
- **`haste`** — the "through / care of" counterparty, see (b) below.

We normalised 55 orders' party spellings to CRR's own wording so they match you
exactly. Every original is preserved in our database and surfaced here, so
nothing detached from its history.

**b) ⚠️ We have a SECOND company-name field that this feed does not carry.**

Our orders have a `haste` column — in this trade it means *"through / care of"*,
i.e. the party the order came via. Despite the name it is **not an urgency
level**: the dropdown holds **2,275 values, all but three of them company names**
(`DONEAR INDUSTRIES`, `ARISTIDE CLOTHING CO.` and so on). The three exceptions —
`Urgent`, `Normal`, `Low` — survive from the app's original seed data and are
used by **zero** orders.

Your spec assumes **one customer name per order**, so there is nowhere to put
it, and we have not invented a place. Today only ~10 of 222 orders populate it,
so it is not yet material — but as usage grows, those orders will be attributed
to `party_name` when the real counterparty may be the `haste` company.

**Please tell us how you want to handle this** — a second field, a separate
relationship type, or explicitly ignore it. We'll follow your lead rather than
guess.

---

*Questions → the LD Order Entry side. The endpoint has been live and verified
against production data since 2026-08-18.*
