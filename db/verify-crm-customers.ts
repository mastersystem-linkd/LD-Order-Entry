// Check of the CRM customer roll-up (§12.5.4, OE-P18) against the DEV schema.
//
// The page sits behind an auth guard, so this exercises the real SQL — the
// grouping, the roll-ups, the sorts and the filters — without a browser.
// Read-only: loadCustomers writes nothing.
//
// Refuses to run against production, like db/verify-crm.ts.
import "./load-env";

if ((process.env.DB_SCHEMA?.trim() || "ld_order_entry") === "ld_order_entry") {
  console.error(
    "Refusing to run: DB_SCHEMA is production. Set it to a dev schema.",
  );
  process.exit(1);
}

async function main() {
  const { loadCustomers } = await import("../lib/crm-query");
  const { customerSignal } = await import("../lib/crm");

  const t0 = Date.now();
  const first = await loadCustomers(new URLSearchParams());
  const ms = Date.now() - t0;
  console.log(
    `loaded ${ms} ms — ${first.total} customers, ${first.totalPages} pages`,
  );
  console.log("kpis:", first.kpis);

  const checks: [string, boolean][] = [];

  console.log("\ntop by value:");
  for (const r of first.rows.slice(0, 8)) {
    console.log(
      `  ${String(r.value12m).padStart(12)}  ${String(r.orders12m).padStart(3)} ord  ` +
        `${(r.crrCustomerId ? `CRR ${r.crrCustomerId}` : "unlinked").padEnd(11)} ` +
        `rating ${r.avgRating ?? "—"}  ${customerSignal(r).padEnd(8)} ${r.name}`,
    );
  }

  const vsorted = first.rows.every(
    (r, i) => i === 0 || Number(first.rows[i - 1].value12m) >= Number(r.value12m),
  );
  checks.push(["default sort is value, descending", vsorted]);

  // An unrated customer must read as "no data", never as a zero score. This is
  // the whole point of the screen on day one.
  checks.push([
    "unrated customers have avgRating null, not 0",
    first.rows.every((r) => r.avgRating === null || r.avgRating > 0),
  ]);
  checks.push([
    "no trend is claimed without ratings",
    first.rows.every((r) => r.avgRating !== null || r.ratingTrend === null),
  ]);

  // Every row must carry at least one live order, or it should not be a row.
  checks.push([
    "every customer has at least one order",
    first.rows.every((r) => r.ordersAll > 0),
  ]);

  // The grouping key must be unique — a duplicate means one customer would
  // appear twice on the same page.
  const keys = new Set(first.rows.map((r) => r.key));
  checks.push(["grouping keys are unique on a page", keys.size === first.rows.length]);

  const byName = await loadCustomers(new URLSearchParams("sort=name"));
  checks.push([
    "sort=name is alphabetical",
    byName.rows.every(
      (r, i) => i === 0 || byName.rows[i - 1].name.localeCompare(r.name) <= 0,
    ),
  ]);

  const byRating = await loadCustomers(new URLSearchParams("sort=rating"));
  const ratedFirst = byRating.rows.filter((r) => r.avgRating !== null);
  checks.push([
    "sort=rating puts unrated last",
    ratedFirst.length === 0 ||
      byRating.rows.slice(0, ratedFirst.length).every((r) => r.avgRating !== null),
  ]);

  const low = await loadCustomers(new URLSearchParams("rated=low"));
  checks.push([
    "rated=low excludes unrated customers",
    low.rows.every((r) => r.avgRating !== null && r.avgRating <= 3),
  ]);

  const someName = first.rows[0]?.name ?? "";
  const found = await loadCustomers(
    new URLSearchParams(`q=${encodeURIComponent(someName.slice(0, 6))}`),
  );
  checks.push(["search finds a known customer", found.total > 0]);

  const linked = first.kpis.linked + first.kpis.unlinked === first.kpis.customers;
  checks.push(["linked + unlinked = total customers", linked]);

  console.log();
  let bad = 0;
  for (const [name, ok] of checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
  console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-crm-customers failed:", e);
  process.exit(1);
});
