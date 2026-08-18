# Why our customers don't match the CRR file

Analysis of the CRR customer alias export against LD Order Entry's live party
names. Reproduce with `npx tsx db/analyse-crr-matching.ts`.

---

## First, a scale correction

> *"There are almost 5,000 customers, but our system is not matching many of them."*

The two lists are not the same size and were never going to match one-for-one:

| | Count |
|---|---:|
| CRR customers (group-wide master) | **4,909** |
| CRR alias rows (spellings on file) | 5,974 |
| LD Order Entry party values | **1,709** |
| Party names actually used on an order | 147 |

CRR is the master for the whole group. LD Order Entry is one trading business
inside it, with roughly a third as many parties. **The most that could ever
match is 1,709** — the other ~3,200 CRR customers simply aren't ours. So the
right question is not "why don't 5,000 match" but **"of our 1,709, how many find
their CRR record, and why do the rest miss?"**

## Headline answer

**90.5% of our party names DO exist in CRR.** They fail to match because the two
systems spell them differently, not because the customer is unknown.

**Only 9.5% (162 of 1,709) are genuinely absent from the CRR file.**

---

## Where every name lands

Each name was run up a ladder of progressively looser normalisations. The rung
where it first matches identifies what defeated the strict rules. **The rungs are
cumulative** — a name in the "plural" row also needed the punctuation fix below it.

### Our full party list — 1,709 names

| # | Reason it missed | Names | Share | Running total matched |
|---|---|---:|---:|---:|
| 0 | Exact alias already on file | 676 | 39.6% | 39.6% |
| 1 | Matched by `scot_canon` as specified | 100 | 5.9% | **45.4%** |
| 2 | Spacing / punctuation around initials | 237 | 13.9% | 59.3% |
| 3 | `CO` vs `COMPANY` | 7 | 0.4% | 59.7% |
| 4 | Singular vs plural | 182 | 10.6% | 70.3% |
| 5 | Decorative prefix (`SHREE`/`SHRI`/`THE`) | 21 | 1.2% | 71.6% |
| 6 | Shortened or extended form | 81 | 4.7% | 76.3% |
| 7 | Spelling variant / typo *(needs review)* | 243 | 14.2% | 90.5% |
| — | **Not in the CRR file at all** | **162** | **9.5%** | — |

### Names actually used on orders — 147 names

| # | Reason it missed | Names | Share | Running total |
|---|---|---:|---:|---:|
| 0 | Exact alias already on file | 49 | 33.3% | 33.3% |
| 1 | Matched by `scot_canon` as specified | 13 | 8.8% | **42.2%** |
| 2 | Spacing / punctuation around initials | 14 | 9.5% | 51.7% |
| 3 | `CO` vs `COMPANY` | 1 | 0.7% | 52.4% |
| 4 | Singular vs plural | 9 | 6.1% | 58.5% |
| 5 | Decorative prefix | 4 | 2.7% | 61.2% |
| 6 | Shortened or extended form | 6 | 4.1% | 65.3% |
| 7 | Spelling variant / typo *(needs review)* | 20 | 13.6% | 78.9% |
| — | **Not in the CRR file at all** | **31** | **21.1%** | — |

Live orders match *worse* than the dropdown as a whole (42% vs 45%), because the
names people actually type are the messy ones.

---

## The five real causes, with evidence

### 1. Spacing around initials — 237 names (13.9%)

The single largest mechanical cause. We type initials with spaces; CRR runs them
together. `scot_canon` collapses *runs* of whitespace but keeps a space that sits
next to a dot, so the two never meet.

| Ours | CRR |
|---|---|
| `R. K. FASHION` | `R.K.FASHION` |
| `A K AGENCY` | `A.K.AGENCY` |
| `A SQUARE CREATION` | `ASQUARE CREATION` |
| `2 BE 3 FASHION` | `2BE3 FASHION` |

**Fix:** fold internal punctuation and spaces before comparing. One line of SQL,
recovers 237 names.

### 2. Singular vs plural — 182 names (10.6%)

Endemic in this trade. Nobody is consistent about the final S.

`A R GARMENT` / `A.R.GARMENTS` · `AARAV ENTERPRISE` / `AARAV ENTERPRISES` ·
`AAINATH TEXTILE` / `AAINATH TEXTILES` · `ADVANCE SYNTHETIC` / `ADVANCE SYNTHETICS`

**Fix:** ignore a trailing S on each word. Recovers 182 names — the second
biggest win and trivially safe, since no two real companies differ only by a
plural.

### 3. Shortened or extended forms — 81 names (4.7%)

One side records the trading name, the other the full legal name.

| Ours | CRR |
|---|---|
| `PR EXPO` | `PR EXPO TRADELINK LLP` |
| `BAFNA CLOTHING` | `BAFNA CLOTHING CO PVT LTD` |
| `BON MOYAR` | `BON MOYAR (INDIA) PRIVATE LIMITED` |
| `ANGEL KIDS` | `ANGEL KIDS WEAR` |

**Fix:** none that is safe to automate. `ANGEL KIDS` vs `ANGEL KIDS WEAR` could
legitimately be two firms. This is review-queue work.

### 4. Spelling variants — 243 names (14.2%) ⚠️ treat with caution

Detected by edit distance ≤ 2. **This bucket is a suggestion, not a conclusion.**
Some are obviously the same company:

`AASHIRWAAD TRADERS` / `ASHIRWAD TRADERS` · `DENNISON INDIA` / `DENISON INDIA` ·
`Coal Khakis Men's Fashion` / `COOL KHAKIS MENS FASHION`

But some near-identical strings are **genuinely different businesses**:

`SURAJ ENTERPRISES` vs `SURYA ENTERPRISES` — Suraj and Surya are different names.

The haste list makes the danger unmistakable, because it is full of
initial-style names where a two-character edit changes the company entirely:

| Paired by edit distance | Reality |
|---|---|
| `A.M.Garments` ~ `A.G.GARMENTS` | different firms |
| `A.P.CLOTHING` ~ `A.M.CLOTHING` | different firms |
| `A.S.Apparels` ~ `A.R.APPARELS` | different firms |
| `Aadya Creation` ~ `NAVYA CREATION` | different firms |
| `Armaan Enterprises` ~ `AMAN ENTERPRISES` | probably different |

**Do not auto-merge this bucket.** Edit distance is unsafe precisely where Indian
trade names are shortest — two initials and a trade word. It is exactly what
SCOT's Rule 5 review queue exists for. Treated as matches it would inflate
coverage to 90%; treated as unknown, real safe coverage is ~76%.

### 5. Decorative prefixes — 21 names (1.2%)

`SHREE` / `SHRI` / `THE` present on one side only: `SHREE BHOLA TRADERS` vs
`BHOLA TRADERS`. Small but free to fix.

---

## The `haste` field — the same customer universe

`haste` (Marathi/Gujarati *हस्ते*, "by the hand of") is the party an order came
**through**. It was analysed the same way, and the result settles what it is.

| | Count |
|---|---:|
| HASTE dropdown values | **2,275** |
| Of those, also present in the PARTY dropdown | **1,463 (64%)** |
| HASTE values used on a live order | 8 (across 10 orders) |

**Two thirds of the haste list is literally the same companies as the party
list.** These are not urgency levels or delivery notes — they are customers,
drawn from the same universe, and they match CRR at almost exactly the same rate.

| Reason it missed | HASTE (2,275) | PARTY (1,709) |
|---|---:|---:|
| Exact alias on file | 28.1% | 39.6% |
| Matched by `scot_canon` | 12.6% | 5.9% |
| — *strict total* | **40.7%** | **45.4%** |
| Spacing / punctuation | 10.8% | 13.9% |
| Singular vs plural | 8.8% | 10.6% |
| Shortened / extended | 4.0% | 4.7% |
| Spelling variant *(review)* | 15.9% | 14.2% |
| **Not in CRR at all** | **18.5%** | **9.5%** |

Two differences worth noting:

- **Haste is twice as likely to be absent from CRR** (18.5% vs 9.5%). Plausibly
  these are intermediaries and agents rather than direct billing customers, so
  they were never opened as CRR accounts.
- **Haste values are mixed-case** (`Ar Apparels`, `Hks Apparel`, `Izod Plus.`)
  where party values are mostly uppercase — the two lists were imported from
  different sources.

### And when haste IS filled, it names a different company

Across the 10 live orders that populate it, **not one haste value equals that
order's `party_name`**. So an order carries two distinct counterparties: who it
is billed to, and who it came through.

This is the open question in the SCOT handover. SCOT's model has room for exactly
one customer per order. Today it is 10 orders out of 222, so nothing is broken —
but every one of those is currently attributed to `party_name` alone, and the
haste company is invisible to SCOT.

---

## Genuinely new customers — 162 names (9.5%)

Not in the CRR file under any spelling: `AAYUSHMAAN`, `AKEELAM EXPORT`,
`BAMBERRY`, `RISHABH MARKETING`, `BEHEST`, `RAYMOND LIFESTYLE LIMITED`,
`SUNDHA CREATION`, `YOGESH TRADING CO.`

Some are large and clearly real (`RAYMOND LIFESTYLE LIMITED`), which suggests
the CRR export we were given may be **partial** rather than that these are new
accounts. Worth asking CRR whether the file covers all divisions.

---

## What this means

**For SCOT.** Two changes to `scot_canon` — folding internal punctuation, and
ignoring trailing plural S — take automatic matching from **45% to 70%** on our
list with no judgement calls and no risk. That is the cheapest available win.

**For us.** Nothing to change. Our names must keep going out verbatim (SCOT's
Rule 1); the alias table is built from raw historical spellings and a tidied
string arrives as a brand-new unknown. Merging our near-duplicates would make
matching worse, not better.

**Realistic expectation.** After the two safe fixes, plan for roughly **30% of
our party names to need human attention at least once** — around 500 names, most
of them low-volume. Once reviewed, an alias is recorded and never asked again.

---

*Method: normalisation ladder plus Levenshtein ≤ 2 near-neighbour detection, run
against the live production database and the CRR alias export. Regenerate with
`npx tsx db/analyse-crr-matching.ts`.*
