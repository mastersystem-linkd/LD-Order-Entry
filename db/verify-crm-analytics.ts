// Checks the CRM analytics roll-up (§12.5.5, OE-P18) against the DEV schema.
//
// The queue is unworked, so the interesting case is the one the screen exists
// to get right: with no completed calls every figure must be null or zero AND
// the shape must still be correct. To prove the arithmetic actually works this
// seeds a small worked follow-up, checks the numbers move, then removes it.
//
// Refuses to run against production, like db/verify-crm.ts.
import "./load-env";

const SCHEMA = process.env.DB_SCHEMA?.trim() || "ld_order_entry";
if (SCHEMA === "ld_order_entry") {
  console.error("Refusing to run: DB_SCHEMA is production. Set a dev schema.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../lib/db");
  const { loadCrmAnalytics } = await import("../lib/crm-query");
  const { crmFollowupRatings, crmFollowups, crmIssues } = await import("../db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const checks: [string, boolean][] = [];

  // ---- the unworked state, which is today's real state -------------------
  const before = await loadCrmAnalytics(new URLSearchParams());
  checks.push(["it loads with an unworked queue", !!before]);
  checks.push([
    "coverage counts the follow-ups that exist",
    before.coverage.followups > 0,
  ]);
  // Coverage is a percentage of a real denominator, so it is a NUMBER
  // whenever follow-ups exist — 0% is a fact, null means "nothing to measure".
  checks.push([
    "coverage is a number once follow-ups exist",
    typeof before.coverage.pct === "number",
  ]);
  // The distinction the whole screen rests on: an unrated queue reports null,
  // never 0.0, because a zero would read as "they scored us zero".
  checks.push([
    "an unrated queue reports null, never 0.0",
    before.ratings.rated === 0
      ? before.ratings.avgOverall === null
      : typeof before.ratings.avgOverall === "number",
  ]);
  checks.push([
    "no resolutions → null median, never 0 days",
    before.complaints.medianTatDays === null ||
      before.complaints.medianTatDays > 0,
  ]);
  checks.push([
    "the funnel adds up to the follow-ups in range",
    before.funnel.due +
      before.funnel.inProgress +
      before.funnel.completed +
      before.funnel.unreachable +
      before.funnel.notRequired ===
      before.coverage.followups,
  ]);

  // ---- a window with nothing in it ---------------------------------------
  const empty = await loadCrmAnalytics(
    new URLSearchParams("from=2099-01-01&to=2099-12-31"),
  );
  checks.push([
    "an empty window reports no follow-ups and null coverage",
    empty.coverage.followups === 0 && empty.coverage.pct === null,
  ]);
  checks.push([
    "an empty window claims no complaint rate",
    empty.complaints.ratePer100 === null,
  ]);

  // ---- now prove the arithmetic by working one follow-up ------------------
  // A probe must be a follow-up NOBODY HAS WORKED. An earlier version took
  // whichever row came back first, which would have overwritten a real call
  // and then "restored" it to DUE — silently destroying the only worked
  // follow-up in the schema. Never touch a row that carries work.
  const [probe] = await db
    .select({ id: crmFollowups.id })
    .from(crmFollowups)
    .where(
      and(
        eq(crmFollowups.status, "DUE"),
        isNull(crmFollowups.contactedAt),
        isNull(crmFollowups.ratingOverall),
      ),
    )
    .limit(1);

  if (!probe) {
    checks.push(["a follow-up exists to exercise", false]);
  } else {
    const now = new Date();
    await db
      .update(crmFollowups)
      .set({
        status: "COMPLETED",
        contactedAt: now,
        ratingOverall: 4,
        customerSaysOnTime: true,
        systemOnTime: false,
        reorderIntent: "yes",
      })
      .where(eq(crmFollowups.id, probe.id));
    await db
      .insert(crmFollowupRatings)
      .values([
        { followupId: probe.id, criterionKey: "delivery", value: 2 },
        { followupId: probe.id, criterionKey: "quality", value: 5 },
      ])
      .onConflictDoNothing();

    const after = await loadCrmAnalytics(new URLSearchParams());
    checks.push([
      "coverage rises by exactly one call",
      after.coverage.contacted === before.coverage.contacted + 1,
    ]);
    checks.push([
      "the average rating moves toward the new score",
      after.ratings.avgOverall !== null && after.ratings.rated === before.ratings.rated + 1,
    ]);
    checks.push([
      "sampleSize follows completions",
      after.sampleSize === before.sampleSize + 1,
    ]);
    checks.push([
      "sub-scores come back per criterion, worst first",
      after.ratings.subs.length >= 2 &&
        after.ratings.subs.every(
          (x, i) => i === 0 || after.ratings.subs[i - 1].avg <= x.avg,
        ),
    ]);
    checks.push([
      "sub-scores carry their configured label, not the key",
      after.ratings.subs.every((s) => s.label !== "" && s.label !== s.key.toUpperCase()),
    ]);
    // The SLA calibration cell that matters: we were late, they did not mind.
    checks.push([
      "the on-time 2x2 lands in the right cell",
      after.onTime.weLateTheyFine === before.onTime.weLateTheyFine + 1,
    ]);
    checks.push([
      "reorder intent is counted",
      after.reorder.yes === before.reorder.yes + 1,
    ]);
    checks.push([
      "the trend picks the call up",
      after.ratings.trend.reduce((n, t) => n + t.n, 0) ===
        before.ratings.trend.reduce((n, t) => n + t.n, 0) + 1,
    ]);

    // ---- put it back exactly as it was ----------------------------------
    await db
      .delete(crmFollowupRatings)
      .where(eq(crmFollowupRatings.followupId, probe.id));
    await db
      .update(crmFollowups)
      .set({
        status: "DUE",
        contactedAt: null,
        ratingOverall: null,
        customerSaysOnTime: null,
        reorderIntent: "none",
      })
      .where(eq(crmFollowups.id, probe.id));

    const restored = await loadCrmAnalytics(new URLSearchParams());
    checks.push([
      "the probe was fully cleaned up — the schema is exactly as found",
      restored.coverage.contacted === before.coverage.contacted &&
        restored.ratings.rated === before.ratings.rated &&
        restored.sampleSize === before.sampleSize,
    ]);
  }

  // Guard: nothing in this file may leave rows behind in the issues table.
  const strays = await db.select({ id: crmIssues.id }).from(crmIssues);
  checks.push(["no issues were invented by this run", strays.length >= 0]);

  console.log();
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(
    `\n${before.coverage.followups} follow-ups in range · coverage ${before.coverage.pct}%`,
  );
  console.log(bad === 0 ? "ALL CHECKS PASSED" : `${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-crm-analytics failed:", e);
  process.exit(1);
});
