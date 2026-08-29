// End-to-end check of the CRM follow-up query against the DEV schema.
//
// Everything the module does sits behind an auth guard, so this exercises the
// real SQL — the reconcile, the roll-ups and the ranking — without a browser.
// It only ever runs loadFollowups(), which inserts follow-up rows for delivered
// orders; it writes nothing else and touches no order, line or stage.
//
// Refuses to run against production, like db/clone-to-dev.ts.
import "./load-env";

if ((process.env.DB_SCHEMA?.trim() || "ld_order_entry") === "ld_order_entry") {
  console.error(
    "Refusing to run: DB_SCHEMA is production. Set it to a dev schema.",
  );
  process.exit(1);
}

async function main() {
  const { loadCrmConfig, loadFollowups } = await import("../lib/crm-query");
  const { isDelivered, deriveOverallRating, followupPriority } = await import(
    "../lib/crm"
  );

  // --- pure derivations, no database -------------------------------------
  const now = new Date("2026-08-29T00:00:00Z");
  const old = new Date("2026-08-01T00:00:00Z");
  const checks: [string, boolean][] = [
    [
      "LR done → delivered",
      isDelivered([{ receivedLrDone: true, dispatchDone: true, dispatchAt: old }], 3, now)
        .delivered,
    ],
    [
      "dispatch + transit elapsed → delivered",
      isDelivered([{ receivedLrDone: false, dispatchDone: true, dispatchAt: old }], 3, now)
        .delivered,
    ],
    [
      "dispatch too recent → NOT delivered",
      !isDelivered(
        [{ receivedLrDone: false, dispatchDone: true, dispatchAt: new Date(now.getTime() - 86400000) }],
        3,
        now,
      ).delivered,
    ],
    [
      "dispatch with no timestamp → NOT delivered",
      !isDelivered([{ receivedLrDone: false, dispatchDone: true, dispatchAt: null }], 3, now)
        .delivered,
    ],
    [
      "one undelivered line blocks the order",
      !isDelivered(
        [
          { receivedLrDone: true, dispatchDone: true, dispatchAt: old },
          { receivedLrDone: false, dispatchDone: false, dispatchAt: null },
        ],
        3,
        now,
      ).delivered,
    ],
    ["zero active lines → NOT delivered", !isDelivered([], 3, now).delivered],
    [
      "overall = mean of the four, rounded",
      deriveOverallRating({ delivery: 2, quality: 5, packing: 2, coordination: 4 }) === 3,
    ],
    [
      "unrated → null, not zero",
      deriveOverallRating({ delivery: null, quality: null, packing: null, coordination: null }) === null,
    ],
    [
      "late + valuable outranks clean + cheap",
      followupPriority({ orderValue: 1800000, systemOnTime: false, hadOutOfStock: false, hadCancellation: false, priorHighSeverity: false, daysOverdue: 2 }) >
        followupPriority({ orderValue: 40000, systemOnTime: true, hadOutOfStock: false, hadCancellation: false, priorHighSeverity: false, daysOverdue: 0 }),
    ],
    [
      "a NULL-rate order still ranks, at value 0",
      Number.isFinite(
        followupPriority({ orderValue: 0, systemOnTime: false, hadOutOfStock: false, hadCancellation: false, priorHighSeverity: false, daysOverdue: 0 }),
      ),
    ],
  ];

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) bad++;
  }

  // --- the real query -----------------------------------------------------
  console.log("\nconfig:", await loadCrmConfig());

  const t0 = Date.now();
  const first = await loadFollowups(new URLSearchParams("page=1"));
  const ms1 = Date.now() - t0;
  console.log(
    `\nfirst load  ${ms1} ms — created ${first.created}, total ${first.total}, ${first.totalPages} pages`,
  );
  console.log("kpis:", first.kpis);

  const t1 = Date.now();
  const second = await loadFollowups(new URLSearchParams("page=1"));
  const ms2 = Date.now() - t1;
  console.log(
    `second load ${ms2} ms — created ${second.created} (must be 0: the reconcile is idempotent), total ${second.total}`,
  );
  if (second.created !== 0) {
    console.error("  FAIL  reconcile is NOT idempotent");
    bad++;
  } else {
    console.log("  PASS  reconcile is idempotent");
  }

  console.log("\ntop of the queue (priority order):");
  for (const r of second.rows.slice(0, 8)) {
    console.log(
      `  ${String(Math.round(r.priority)).padStart(3)}  ${r.band.padEnd(6)} ${r.orderNo.padEnd(16)} ` +
        `${(r.partyName ?? "").slice(0, 26).padEnd(26)} value ${String(Math.round(r.orderValue)).padStart(9)} ` +
        `${r.systemOnTime === false ? "LATE" : "ontime"} waited ${r.daysWaiting}d  ${r.status}`,
    );
  }

  // Sorted descending by priority?
  const ps = second.rows.map((r) => r.priority);
  const sorted = ps.every((v, i) => i === 0 || ps[i - 1] >= v);
  console.log(`\n  ${sorted ? "PASS" : "FAIL"}  page is ordered by priority, descending`);
  if (!sorted) bad++;

  const byValue = await loadFollowups(new URLSearchParams("sort=value"));
  const vs = byValue.rows.map((r) => r.orderValue);
  const vsorted = vs.every((v, i) => i === 0 || vs[i - 1] >= v);
  console.log(`  ${vsorted ? "PASS" : "FAIL"}  sort=value orders by value, descending`);
  if (!vsorted) bad++;

  const filtered = await loadFollowups(new URLSearchParams("status=DUE"));
  const allDue = filtered.rows.every((r) => r.status === "DUE");
  console.log(`  ${allDue ? "PASS" : "FAIL"}  status=DUE returns only DUE rows (${filtered.total})`);
  if (!allDue) bad++;

  const searched = await loadFollowups(
    new URLSearchParams(`q=${encodeURIComponent(second.rows[0]?.orderNo ?? "")}`),
  );
  console.log(
    `  ${searched.total >= 1 ? "PASS" : "FAIL"}  search by order no finds it (${searched.total})`,
  );
  if (searched.total < 1) bad++;

  console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
