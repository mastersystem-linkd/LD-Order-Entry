// Loads the CRR customer alias export into ld_order_entry.crr_customers.
//
// CRR is the group's customer master; SCOT resolves our free-text party names
// against it. Holding a local copy lets us offer canonical spellings in the
// Dropdown Master, link orders to a CRR customer, and emit the CRR customer_id
// on the export (SCOT's exact-match path).
//
// Idempotent — safe to re-run when CRR sends a fresh export.
//
//   npx tsx db/load-crr-customers.ts <path-to-csv>
import "./load-env";

import fs from "node:fs";

import { db } from "@/lib/db";
import { crrCustomers } from "@/db/schema";
import { crrCanon, crrTight, tidyDisplayName } from "@/lib/crr-match";

const CSV =
  process.argv[2] ?? "C:/Users/Admin/Downloads/crr_customer_alias_rows.csv";

type Row = { customerId: number; alias: string | null; fullRawName: string };

// The CSV is customer_id,alias,full_raw_name. Names contain commas rarely but
// aliases never do, so split on the first two commas and keep the remainder.
function parse(csv: string): Row[] {
  const out: Row[] = [];
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const i = line.indexOf(",");
    const j = line.indexOf(",", i + 1);
    if (i < 0 || j < 0) continue;
    const customerId = Number.parseInt(line.slice(0, i), 10);
    const alias = line.slice(i + 1, j).trim().replace(/^"|"$/g, "");
    const fullRawName = line.slice(j + 1).trim().replace(/^"|"$/g, "");
    if (!Number.isFinite(customerId) || !fullRawName) continue;
    out.push({ customerId, alias: alias || null, fullRawName });
  }
  return out;
}

// The spelling we show for a customer: prefer one with no branch tag, no
// trailing dots and no bracket group, then the shortest. CRR keeps several
// spellings per customer and most of them are punctuation noise.
//
// Trailing bracket groups are ALWAYS removed, even when every spelling on file
// carries one. They are branch/route markers ("(N)", "(JOB)", "(AITK)"), not
// part of the company name — CRR's own canon strips them. Keeping one would
// mean stamping an order with a branch nobody recorded.
function pickDisplay(rows: Row[]): string {
  const score = (r: Row) =>
    (r.alias ? 0 : 4) +
    (/[.\s]$/.test(r.fullRawName) ? 0 : 2) +
    (/\([^()]*\)\s*$/.test(r.fullRawName) ? 0 : 1);
  const best = [...rows].sort(
    (a, b) => score(b) - score(a) || a.fullRawName.length - b.fullRawName.length,
  )[0];
  let name = best.fullRawName;
  let prev: string;
  do {
    prev = name;
    name = name.replace(/(\s*\([^()]*\)\s*)+$/, "");
  } while (name !== prev);
  return tidyDisplayName(name) || tidyDisplayName(best.fullRawName);
}

async function main() {
  if (!fs.existsSync(CSV)) {
    console.error(`CSV not found: ${CSV}`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(CSV, "utf8"));
  const byCustomer = new Map<number, Row[]>();
  for (const r of rows) {
    const arr = byCustomer.get(r.customerId) ?? [];
    arr.push(r);
    byCustomer.set(r.customerId, arr);
  }
  console.log(`Parsed ${rows.length} alias rows for ${byCustomer.size} customers`);

  const display = new Map<number, string>();
  for (const [id, rs] of byCustomer) display.set(id, pickDisplay(rs));

  // Stripping branch tags can collide two customers onto one display string
  // (e.g. two firms both reduced to "SAI KRUPA"). Where that happens keep the
  // tag on the later ones so the Dropdown Master never shows an ambiguous entry.
  const byDisplay = new Map<string, number[]>();
  for (const [id, d] of display) {
    const arr = byDisplay.get(d.toUpperCase()) ?? [];
    arr.push(id);
    byDisplay.set(d.toUpperCase(), arr);
  }
  let disambiguated = 0;
  for (const [, ids] of byDisplay) {
    if (ids.length < 2) continue;
    for (const id of ids.slice(1)) {
      const tagged = byCustomer.get(id)!.find((r) => r.alias);
      // Prefer CRR's own branch tag. Where the colliding customer has no
      // tagged spelling at all, fall back to its CRR id — an EARLIER version
      // only handled the tagged case and silently left both customers sharing
      // one name, which put two identical entries in the PARTY and HASTE
      // dropdowns pointing at different customers (CRR 62 and 94, both
      // "GARODIA SYNTEX PVT LTD"). A name nobody can tell apart is worse than
      // an ugly one.
      display.set(
        id,
        tagged
          ? tidyDisplayName(tagged.fullRawName)
          : `${display.get(id)} [CRR ${id}]`,
      );
      disambiguated++;
    }
  }
  if (disambiguated) {
    console.log(`Kept branch tags on ${disambiguated} customers to avoid duplicate display names`);
  }

  // Dedupe on (customer_id, full_raw_name) — the unique key — because CRR
  // exports occasionally repeat a spelling.
  const seen = new Set<string>();
  const values = rows
    .filter((r) => {
      const k = `${r.customerId}\u0000${r.fullRawName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({
      customerId: r.customerId,
      alias: r.alias,
      fullRawName: r.fullRawName,
      displayName: display.get(r.customerId)!,
      canon: crrCanon(r.fullRawName),
      tight: crrTight(r.fullRawName),
    }));

  console.log("Replacing crr_customers…");
  await db.delete(crrCustomers);
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(crrCustomers).values(values.slice(i, i + 500));
  }

  const stored = await db.select({ id: crrCustomers.id }).from(crrCustomers);
  console.log(`Loaded ${values.length} rows (table now holds ${stored.length}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Load failed:", e);
  process.exit(1);
});
