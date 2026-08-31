// Brings the CRR customer list into the PARTY and HASTE dropdowns, and tags
// every dropdown value with the CRR customer it resolves to.
//
// DRY RUN BY DEFAULT. Pass --apply to commit.
//
//   npx tsx db/sync-crr-dropdowns.ts
//   npx tsx db/sync-crr-dropdowns.ts --apply
//
// WHAT IT DOES
//  1. Tags existing values with crr_customer_id where they resolve to a CRR
//     customer. That is what powers the "In CRR" badge.
//  2. Adds CRR customers that no existing value already covers.
//
// WHAT IT DOES NOT DO
//  * It never deletes or rewrites an existing dropdown value. Names already in
//    use on orders stay exactly as they are.
//  * It never adds a CRR customer that an existing value already resolves to —
//    otherwise the list would fill with near-duplicate spellings of the same
//    firm, which is the problem we are trying to solve.
import "./load-env";

import { eq, sql } from "drizzle-orm";

import { db, dbx } from "@/lib/db";
import { crrCanon, crrTight } from "@/lib/crr-match";
import { crrCustomers, lookupValues } from "@/db/schema";

const APPLY = process.argv.includes("--apply");
const CATEGORIES = ["PARTY", "HASTE"] as const;

async function main() {
  const crr = await db
    .select({
      customerId: crrCustomers.customerId,
      fullRawName: crrCustomers.fullRawName,
      displayName: crrCustomers.displayName,
      canon: crrCustomers.canon,
      tight: crrCustomers.tight,
    })
    .from(crrCustomers);

  const mk = () => new Map<string, Set<number>>();
  const exact = mk(), canon = mk(), tight = mk();
  const display = new Map<number, string>();
  const add = (m: Map<string, Set<number>>, k: string, id: number) => {
    if (!k) return;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(id);
  };
  for (const r of crr) {
    display.set(r.customerId, r.displayName);
    add(exact, r.fullRawName.trim().toUpperCase(), r.customerId);
    add(canon, r.canon, r.customerId);
    add(tight, r.tight, r.customerId);
  }
  const resolve = (name: string): number | null => {
    for (const [m, k] of [
      [exact, name.trim().toUpperCase()],
      [canon, crrCanon(name)],
      [tight, crrTight(name)],
    ] as const) {
      const ids = m.get(k);
      if (ids && ids.size === 1) return [...ids][0];
    }
    return null;
  };

  console.log(`CRR: ${crr.length} spellings, ${display.size} customers\n`);

  const tagUpdates: { id: string; crrCustomerId: number }[] = [];
  const inserts: { category: string; value: string; crrCustomerId: number }[] = [];

  for (const category of CATEGORIES) {
    const existing = await db
      .select({
        id: lookupValues.id,
        value: lookupValues.value,
        crrCustomerId: lookupValues.crrCustomerId,
      })
      .from(lookupValues)
      .where(eq(lookupValues.category, category));

    const covered = new Set<number>();
    let tagged = 0;
    for (const v of existing) {
      const id = resolve(v.value);
      if (id == null) continue;
      covered.add(id);
      if (v.crrCustomerId !== id) {
        tagUpdates.push({ id: v.id, crrCustomerId: id });
        tagged++;
      }
    }

    const toAdd = [...display.entries()].filter(([id]) => !covered.has(id));
    for (const [id, name] of toAdd) {
      inserts.push({ category, value: name.slice(0, 200), crrCustomerId: id });
    }

    console.log(`${category}`);
    console.log(`  existing values              ${existing.length}`);
    console.log(`  of those, known to CRR       ${covered.size}  (${tagged} newly tagged)`);
    console.log(`  CRR customers not yet listed ${toAdd.length}  <- to be added`);
    console.log(`  list size after sync         ${existing.length + toAdd.length}\n`);
  }

  if (!APPLY) {
    console.log(`DRY RUN — would tag ${tagUpdates.length} values and add ${inserts.length}. Nothing written.`);
    console.log("Re-run with --apply to commit.");
    process.exit(0);
  }

  console.log(`Applying: tagging ${tagUpdates.length}, inserting ${inserts.length}…`);
  await dbx.transaction(async (tx) => {
    for (const u of tagUpdates) {
      await tx
        .update(lookupValues)
        .set({ crrCustomerId: u.crrCustomerId })
        .where(eq(lookupValues.id, u.id));
    }
    for (let i = 0; i < inserts.length; i += 500) {
      await tx
        .insert(lookupValues)
        .values(inserts.slice(i, i + 500))
        // uq_lookup_values_category_value (migration 0004). The pre-filter
        // above should make this unreachable; if it ever isn't, skipping a
        // duplicate beats aborting the whole sync.
        .onConflictDoNothing();
    }
  });

  const after = await db
    .select({
      category: lookupValues.category,
      total: sql<number>`count(*)::int`,
      linked: sql<number>`count(${lookupValues.crrCustomerId})::int`,
    })
    .from(lookupValues)
    .groupBy(lookupValues.category);
  console.log("\nFinal state:");
  for (const r of after) {
    console.log(`  ${r.category.padEnd(14)} ${String(r.total).padStart(5)} values, ${String(r.linked).padStart(5)} linked to CRR`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
