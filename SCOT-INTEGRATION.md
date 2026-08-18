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
        "party_name": "Spinder Fibres Pvt Ltd", // VERBATIM, see §5
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
| `customer_id` (CRR) | **not available** — see §6 |

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
1,695 distinct companies** — 14 near-duplicates, none of which appear on any
order. Your alias layer will absorb all of them (`FOCUS LIFESTYLE` vs
`FOCUS LIFESTYLE PVT LTD`, etc.). We deliberately did **not** merge them, per
your Rule 2.

## 6. Two open items from our side

**a) We have no CRR `customer_id`.** Your Rule 4 calls it "gold" and we agree —
but we can't derive it. **If CRR can give us a party-name → `customer_id`
mapping, we'll store it and add it to this feed**, taking you from heuristic to
exact matching. Please send the list if it exists.

**b) ⚠️ We have a SECOND company-name field that this feed does not carry.**

Our orders have a `haste` column — in this trade it means *"through / care of"*,
i.e. the party the order came via. It holds **company names, not urgency
levels**: our dropdown has **2,275 of them** (`DONEAR INDUSTRIES`,
`ARISTIDE CLOTHING CO.` and so on).

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
