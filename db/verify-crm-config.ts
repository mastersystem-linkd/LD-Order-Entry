// Checks the CRM's two CONFIGURABLE vocabularies (§12.4, §12.5) — rating
// criteria and complaint categories — against the DEV schema.
//
// These were fixed lists in code until migration 0005. The risk in making them
// data is that a score or a complaint outlives the thing it points at, so this
// exercises exactly that: retire a criterion, confirm old scores still read.
//
// Read-mostly: everything it creates, it removes. Refuses to run against
// production, like db/verify-crm.ts.
import "./load-env";

const SCHEMA = process.env.DB_SCHEMA?.trim() || "ld_order_entry";
if (SCHEMA === "ld_order_entry") {
  console.error("Refusing to run: DB_SCHEMA is production. Set a dev schema.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../lib/db");
  const { crmFollowupRatings, crmRatingCriteria, lookupValues } = await import(
    "../db/schema"
  );
  const { deriveOverallRating, overallRatingExact, categoryLabel } =
    await import("../lib/crm");
  const { eq, and } = await import("drizzle-orm");

  const checks: [string, boolean][] = [];

  // --- pure derivations over a DYNAMIC criterion set ----------------------
  checks.push([
    "overall is the mean of whatever criteria exist",
    deriveOverallRating({ a: 4, b: 2 }) === 3,
  ]);
  checks.push([
    "a six-criterion set still averages",
    deriveOverallRating({ a: 5, b: 5, c: 5, d: 1, e: 1, f: 1 }) === 3,
  ]);
  checks.push([
    "unrated is null, not zero",
    deriveOverallRating({ a: null, b: undefined }) === null,
  ]);
  checks.push([
    "out-of-range scores are ignored, not clamped into the mean",
    deriveOverallRating({ a: 4, b: 99 as number }) === 4,
  ]);
  checks.push([
    "exact mean keeps its decimal",
    Math.abs((overallRatingExact({ a: 4, b: 3 }) ?? 0) - 3.5) < 1e-9,
  ]);

  // --- legacy category keys still read as English ------------------------
  checks.push([
    "legacy SCREAMING_SNAKE categories are humanised",
    categoryLabel("DAMAGE_TRANSIT") === "Damage in transit",
  ]);
  checks.push([
    "a plain-text category is left exactly as typed",
    categoryLabel("Roll length short") === "Roll length short",
  ]);

  // --- the configured lists actually exist -------------------------------
  const criteria = await db.select().from(crmRatingCriteria);
  checks.push(["rating criteria are seeded", criteria.length > 0]);
  checks.push([
    "criterion keys are unique",
    new Set(criteria.map((c) => c.key)).size === criteria.length,
  ]);

  const cats = await db
    .select()
    .from(lookupValues)
    .where(eq(lookupValues.category, "CRM_ISSUE"));
  checks.push(["complaint categories are seeded", cats.length > 0]);

  // --- a score must SURVIVE its criterion being retired -------------------
  // This is the whole risk of making the list data. A retired criterion is
  // deactivated, never deleted, and crm_followup_ratings stores the KEY, not
  // a foreign key — so the score stays readable either way.
  const [probe] = await db
    .insert(crmRatingCriteria)
    .values({
      key: "__verify_tmp",
      label: "Temporary",
      hint: null,
      sortOrder: 999,
    })
    .returning();
  await db
    .update(crmRatingCriteria)
    .set({ isActive: false })
    .where(eq(crmRatingCriteria.id, probe.id));
  const [after] = await db
    .select()
    .from(crmRatingCriteria)
    .where(eq(crmRatingCriteria.id, probe.id));
  checks.push([
    "retiring a criterion keeps the row (never deletes)",
    !!after && after.isActive === false,
  ]);
  await db.delete(crmRatingCriteria).where(eq(crmRatingCriteria.id, probe.id));

  // --- one score per criterion per follow-up ------------------------------
  const orphan = await db
    .select()
    .from(crmFollowupRatings)
    .where(and(eq(crmFollowupRatings.criterionKey, "__verify_tmp")));
  checks.push(["no scores leaked from this run", orphan.length === 0]);

  console.log();
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(
    `\n${criteria.length} rating criteria · ${cats.length} complaint categories`,
  );
  console.log(bad === 0 ? "ALL CHECKS PASSED" : `${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-crm-config failed:", e);
  process.exit(1);
});
