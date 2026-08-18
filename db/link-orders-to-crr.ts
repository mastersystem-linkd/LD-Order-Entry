// Links existing orders to their CRR customer and normalises party / haste
// spellings to the CRR name.
//
// DRY RUN BY DEFAULT — prints exactly what it would change and writes nothing.
// Pass --apply to commit.
//
//   npx tsx db/link-orders-to-crr.ts            # show proposed changes
//   npx tsx db/link-orders-to-crr.ts --apply    # commit them
//
// SAFETY
//  * The operator's original text is copied to party_name_original /
//    haste_original before anything is overwritten, so every order can be shown
//    or restored exactly as it was written. Already-populated originals are
//    never overwritten, so re-running cannot lose the first value.
//  * A name that resolves to more than one CRR customer is SKIPPED, never
//    guessed. Same for anything the three deterministic rules don't reach.
//  * Line items, quantities, rates, tracking stages and totals are untouched —
//    this only rewrites two text columns on the order header.
import "./load-env";

import { eq, sql } from "drizzle-orm";

import { db, dbx } from "@/lib/db";
import { crrCanon, crrTight, type CrrMatchMethod } from "@/lib/crr-match";
import { crrCustomers, customerOrders } from "@/db/schema";

const APPLY = process.argv.includes("--apply");

type Hit = { customerId: number; display: string };

async function buildIndex() {
  const rows = await db
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
  for (const r of rows) {
    display.set(r.customerId, r.displayName);
    add(exact, r.fullRawName.trim().toUpperCase(), r.customerId);
    add(canon, r.canon, r.customerId);
    add(tight, r.tight, r.customerId);
  }
  return { exact, canon, tight, display, rows: rows.length };
}

type Index = Awaited<ReturnType<typeof buildIndex>>;

/** Resolve a typed name to exactly one CRR customer, or null. Never guesses. */
function resolve(name: string, ix: Index): { hit: Hit; method: CrrMatchMethod } | null {
  const attempts: [CrrMatchMethod, Map<string, Set<number>>, string][] = [
    ["exact", ix.exact, name.trim().toUpperCase()],
    ["canon", ix.canon, crrCanon(name)],
    ["tight", ix.tight, crrTight(name)],
  ];
  for (const [method, map, key] of attempts) {
    const ids = map.get(key);
    // More than one customer behind the same key = genuinely ambiguous. Skip.
    if (ids && ids.size === 1) {
      const customerId = [...ids][0];
      return { hit: { customerId, display: ix.display.get(customerId)! }, method };
    }
  }
  return null;
}

async function main() {
  const ix = await buildIndex();
  console.log(`CRR index: ${ix.rows} spellings, ${ix.display.size} customers\n`);

  const orders = await db
    .select({
      id: customerOrders.id,
      orderNo: customerOrders.orderNo,
      partyName: customerOrders.partyName,
      partyOriginal: customerOrders.partyNameOriginal,
      haste: customerOrders.haste,
      hasteOriginal: customerOrders.hasteOriginal,
      crrCustomerId: customerOrders.crrCustomerId,
    })
    .from(customerOrders);

  const stats: Record<string, number> = {
    linked_exact: 0, linked_canon: 0, linked_tight: 0,
    party_renamed: 0, party_already_correct: 0, party_unresolved: 0,
    haste_renamed: 0, haste_already_correct: 0, haste_unresolved: 0,
  };
  const samples: string[] = [];
  const updates: {
    id: string; crrCustomerId: number | null;
    party?: string; partyOrig?: string;
    haste?: string; hasteOrig?: string;
  }[] = [];

  for (const o of orders) {
    const patch: (typeof updates)[number] = { id: o.id, crrCustomerId: o.crrCustomerId };

    const pm = resolve(o.partyName, ix);
    if (pm) {
      stats[`linked_${pm.method}`]++;
      patch.crrCustomerId = pm.hit.customerId;
      if (o.partyName !== pm.hit.display) {
        patch.party = pm.hit.display;
        // Only capture the original once — a re-run must not overwrite it.
        if (!o.partyOriginal) patch.partyOrig = o.partyName;
        stats.party_renamed++;
        if (samples.length < 25) {
          samples.push(
            `  ${o.orderNo.padEnd(8)} ${pm.method.padEnd(5)} ${o.partyName}  ->  ${pm.hit.display}`,
          );
        }
      } else stats.party_already_correct++;
    } else stats.party_unresolved++;

    if (o.haste && o.haste.trim()) {
      const hm = resolve(o.haste, ix);
      if (hm) {
        if (o.haste !== hm.hit.display) {
          patch.haste = hm.hit.display;
          if (!o.hasteOriginal) patch.hasteOrig = o.haste;
          stats.haste_renamed++;
        } else stats.haste_already_correct++;
      } else stats.haste_unresolved++;
    }

    if (patch.party || patch.haste || patch.crrCustomerId !== o.crrCustomerId) {
      updates.push(patch);
    }
  }

  console.log(`Orders examined: ${orders.length}\n`);
  console.log("PARTY");
  console.log(`  linked to a CRR customer   ${stats.linked_exact + stats.linked_canon + stats.linked_tight}`);
  console.log(`     exact spelling          ${stats.linked_exact}`);
  console.log(`     after canon rules       ${stats.linked_canon}`);
  console.log(`     after spacing/plural    ${stats.linked_tight}`);
  console.log(`  spelling to be corrected   ${stats.party_renamed}`);
  console.log(`  already the CRR spelling   ${stats.party_already_correct}`);
  console.log(`  NOT in CRR - left alone    ${stats.party_unresolved}`);
  console.log("\nHASTE");
  console.log(`  spelling to be corrected   ${stats.haste_renamed}`);
  console.log(`  already the CRR spelling   ${stats.haste_already_correct}`);
  console.log(`  NOT in CRR - left alone    ${stats.haste_unresolved}`);

  if (samples.length) {
    console.log(`\nSample renames (first ${samples.length}):`);
    samples.forEach((s) => console.log(s));
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — ${updates.length} orders would be updated. Nothing written.`);
    console.log("Re-run with --apply to commit.");
    process.exit(0);
  }

  console.log(`\nApplying to ${updates.length} orders…`);
  await dbx.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(customerOrders)
        .set({
          crrCustomerId: u.crrCustomerId,
          ...(u.party ? { partyName: u.party } : {}),
          ...(u.partyOrig ? { partyNameOriginal: u.partyOrig } : {}),
          ...(u.haste ? { haste: u.haste } : {}),
          ...(u.hasteOrig ? { hasteOriginal: u.hasteOrig } : {}),
          // Bump so the incremental export re-emits these orders to SCOT and
          // the Embroidery System.
          updatedAt: new Date(),
        })
        .where(eq(customerOrders.id, u.id));
    }
  });

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customerOrders)
    .where(sql`${customerOrders.partyNameOriginal} is not null`);
  console.log(`Done. ${n} orders now carry their original party name for audit.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
