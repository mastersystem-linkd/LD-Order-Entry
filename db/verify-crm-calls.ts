// Checks the call log (§12.5.6) against the DEV schema.
//
// This screen exists because feedback, the per-criterion scores and the
// reorder note were WRITE-ONLY — recorded by the call panel and readable
// nowhere else. So the checks that matter are: does a call's own words come
// back, do its scores come back labelled, and does an untouched follow-up stay
// out of a log of work that was done.
//
// It writes a probe onto a follow-up nobody has worked, asserts, then restores
// it. Refuses to run against production.
import "./load-env";

const SCHEMA = process.env.DB_SCHEMA?.trim() || "ld_order_entry";
if (SCHEMA === "ld_order_entry") {
  console.error("Refusing to run: DB_SCHEMA is production. Set a dev schema.");
  process.exit(1);
}

async function main() {
  const { db } = await import("../lib/db");
  const { loadCalls } = await import("../lib/crm-query");
  const { crmFollowupRatings, crmFollowups } = await import("../db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const checks: [string, boolean][] = [];
  const before = await loadCalls(new URLSearchParams());

  checks.push(["it loads", !!before]);
  checks.push([
    "an untouched DUE follow-up is not a call",
    before.rows.every(
      (r) =>
        r.contactedAt !== null ||
        r.ratingOverall !== null ||
        !!r.feedback ||
        ["COMPLETED", "UNREACHABLE", "NOT_REQUIRED"].includes(r.status),
    ),
  ]);
  checks.push([
    "newest first",
    before.rows.every(
      (r, i) =>
        i === 0 ||
        (before.rows[i - 1].contactedAt ?? "") >= (r.contactedAt ?? ""),
    ),
  ]);

  // ---- a worked call, with everything the panel can record ----------------
  const [probe] = await db
    .select({ id: crmFollowups.id })
    .from(crmFollowups)
    .where(
      and(
        eq(crmFollowups.status, "DUE"),
        isNull(crmFollowups.contactedAt),
        isNull(crmFollowups.ratingOverall),
        isNull(crmFollowups.notes),
      ),
    )
    .limit(1);

  if (!probe) {
    checks.push(["an unworked follow-up exists to probe", false]);
  } else {
    const FEEDBACK =
      "__verify__ said the packing was excellent but the driver was late twice";
    const REORDER = "__verify__ wants 2,000 m satin crepe in September";
    await db
      .update(crmFollowups)
      .set({
        status: "COMPLETED",
        contactedAt: new Date(),
        ratingOverall: 4,
        ratingSource: "customer",
        customerSaysOnTime: false,
        delayReason: "Transport",
        notes: FEEDBACK,
        reorderIntent: "yes",
        reorderNote: REORDER,
        completedBy: "verify@local",
      })
      .where(eq(crmFollowups.id, probe.id));
    await db
      .insert(crmFollowupRatings)
      .values([
        { followupId: probe.id, criterionKey: "delivery", value: 2 },
        { followupId: probe.id, criterionKey: "packing", value: 5 },
      ])
      .onConflictDoNothing();

    const after = await loadCalls(new URLSearchParams());
    const rec = after.rows.find((r) => r.followupId === probe.id);

    checks.push(["the worked call appears in the log", !!rec]);
    // The whole point: these three were write-only before this screen.
    checks.push(["the FEEDBACK text comes back", rec?.feedback === FEEDBACK]);
    checks.push(["the REORDER note comes back", rec?.reorderNote === REORDER]);
    checks.push([
      "the per-criterion scores come back, labelled",
      rec?.subRatings.length === 2 &&
        rec.subRatings.every((s) => !!s.label && s.label !== s.key.toUpperCase()),
    ]);
    checks.push([
      "the rest of the call comes back",
      rec?.ratingOverall === 4 &&
        rec.ratingSource === "customer" &&
        rec.customerSaysOnTime === false &&
        rec.delayReason === "Transport" &&
        rec.completedBy === "verify@local",
    ]);

    // Searching the FEEDBACK is the question this screen answers.
    const found = await loadCalls(new URLSearchParams("q=packing was excellent"));
    checks.push([
      "search reaches inside the feedback text",
      found.rows.some((r) => r.followupId === probe.id),
    ]);
    const foundReorder = await loadCalls(new URLSearchParams("q=satin crepe"));
    checks.push([
      "search reaches inside the reorder note",
      foundReorder.rows.some((r) => r.followupId === probe.id),
    ]);

    const withFeedback = await loadCalls(new URLSearchParams("has=feedback"));
    checks.push([
      "has=feedback returns only calls that have some",
      withFeedback.rows.every((r) => !!r.feedback?.trim()) &&
        withFeedback.rows.some((r) => r.followupId === probe.id),
    ]);
    const withReorder = await loadCalls(new URLSearchParams("has=reorder"));
    checks.push([
      "has=reorder returns only calls that want something",
      withReorder.rows.every((r) => r.reorderIntent !== "none"),
    ]);
    checks.push([
      "the KPIs count what the filters return",
      after.kpis.withFeedback === before.kpis.withFeedback + 1 &&
        after.kpis.reorderSignals === before.kpis.reorderSignals + 1,
    ]);

    // ---- restore ---------------------------------------------------------
    await db
      .delete(crmFollowupRatings)
      .where(eq(crmFollowupRatings.followupId, probe.id));
    await db
      .update(crmFollowups)
      .set({
        status: "DUE",
        contactedAt: null,
        ratingOverall: null,
        ratingSource: null,
        customerSaysOnTime: null,
        delayReason: null,
        notes: null,
        reorderIntent: "none",
        reorderNote: null,
        completedBy: null,
      })
      .where(eq(crmFollowups.id, probe.id));

    const restored = await loadCalls(new URLSearchParams());
    checks.push([
      "the probe was fully cleaned up",
      restored.total === before.total &&
        restored.kpis.withFeedback === before.kpis.withFeedback,
    ]);
  }

  console.log();
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(`\n${before.total} worked calls on file`);
  console.log(bad === 0 ? "ALL CHECKS PASSED" : `${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-crm-calls failed:", e);
  process.exit(1);
});
