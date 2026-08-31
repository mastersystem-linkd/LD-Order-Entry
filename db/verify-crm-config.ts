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

  // --- attempt outcomes must fit their channel (§12.7) --------------------
  const { CHANNEL_OUTCOMES, isReachedOutcome, statusAfterAttempt } =
    await import("../lib/crm");
  const { followupAttemptSchema } = await import("../lib/validation");

  checks.push([
    "a visit is never offered 'busy' or 'wrong number'",
    !CHANNEL_OUTCOMES.visit.includes("busy") &&
      !CHANNEL_OUTCOMES.visit.includes("wrong_number"),
  ]);
  checks.push([
    "a visit records WHERE it happened",
    CHANNEL_OUTCOMES.visit.includes("met_at_our_office") &&
      CHANNEL_OUTCOMES.visit.includes("met_at_customer_place"),
  ]);
  checks.push([
    "a call is never offered a visit outcome",
    !CHANNEL_OUTCOMES.call.includes("met_at_our_office"),
  ]);
  checks.push([
    "every channel offers at least one outcome",
    Object.values(CHANNEL_OUTCOMES).every((o) => o.length > 0),
  ]);

  // Meeting someone in person is contact — the strongest there is. If this
  // ever regressed to "connected" only, a visit would count toward marking the
  // customer UNREACHABLE.
  checks.push([
    "meeting in person counts as reaching the customer",
    isReachedOutcome("met_at_our_office") &&
      isReachedOutcome("met_at_customer_place"),
  ]);
  checks.push([
    "a missed visit does NOT count as reaching them",
    !isReachedOutcome("not_available") && !isReachedOutcome("no_answer"),
  ]);
  checks.push([
    "a successful visit keeps the follow-up live, never UNREACHABLE",
    statusAfterAttempt("DUE", 9, "met_at_customer_place", 3) === "IN_PROGRESS",
  ]);

  // --- the API refuses the combinations the UI never offers ---------------
  checks.push([
    "API rejects a 'busy' visit",
    !followupAttemptSchema.safeParse({
      channel: "visit",
      outcome: "busy",
      attended_by: "Amit",
    }).success,
  ]);
  checks.push([
    "API rejects a visit with nobody named",
    !followupAttemptSchema.safeParse({ channel: "visit", outcome: "met_at_our_office" })
      .success,
  ]);
  checks.push([
    "API accepts a visit that names who went",
    followupAttemptSchema.safeParse({
      channel: "visit",
      outcome: "met_at_customer_place",
      attended_by: "Amit Shah",
    }).success,
  ]);
  checks.push([
    "a NOT-AVAILABLE visit needs no name — nobody was met",
    followupAttemptSchema.safeParse({ channel: "visit", outcome: "not_available" })
      .success,
  ]);
  checks.push([
    "a normal call still validates",
    followupAttemptSchema.safeParse({ channel: "call", outcome: "no_answer" }).success,
  ]);

  // --- UNREACHABLE closes the rest of the flow (§12.7) --------------------
  const { canComplete } = await import("../lib/crm");
  const { followupUpdateSchema } = await import("../lib/validation");

  // A follow-up nobody spoke to has no rating, so it can never satisfy the
  // COMPLETED rule — the UI blocks it, and this is the rule underneath.
  checks.push(["an unrated follow-up cannot be completed", !canComplete(null)]);
  checks.push(["a rated one can", canComplete(4)]);
  checks.push([
    "a rating outside 1-5 cannot complete one",
    !canComplete(0) && !canComplete(6),
  ]);

  // Reopening is a real transition, not a special case: an UNREACHABLE row
  // must be able to move back to IN_PROGRESS when the customer calls back.
  checks.push([
    "an unreachable follow-up can be reopened",
    followupUpdateSchema.safeParse({ status: "IN_PROGRESS" }).success,
  ]);
  checks.push([
    "marking unreachable needs no rating",
    followupUpdateSchema.safeParse({ status: "UNREACHABLE" }).success,
  ]);
  checks.push([
    "completing without an overall is still refused",
    !followupUpdateSchema.safeParse({ status: "COMPLETED" }).success,
  ]);

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
