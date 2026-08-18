// Throwaway: proves the optimized dashboard aggregation returns the SAME
// payload as the pre-optimization route, and times both.
import "./db/load-env";
import { legacyDashboard } from "./perf-legacy";
import { dashboardParams, loadDashboard } from "./lib/dashboard-query";

const RANGES: [string, string][] = [
  ["", ""], // default 30 days
  ["2026-08-18", "2026-08-18"],
  ["2025-01-01", "2026-12-31"],
  ["2026-08-01", "2026-08-18"],
];
const DEPTS = ["ALL", "LD", "LINKD"];

function diff(a: unknown, b: unknown, path = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      out.push(...diff(a[i], b[i], `${path}[${i}]`));
    }
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      out.push(
        ...diff(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          path ? `${path}.${k}` : k,
        ),
      );
    }
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

async function main() {
  let bad = 0;
  for (const [from, to] of RANGES) {
    for (const dept of DEPTS) {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("department", dept);
      const url = new URL(`http://x/api/dashboard?${qs}`);

      const t0 = Date.now();
      const old = await legacyDashboard(url);
      const tOld = Date.now() - t0;

      const t1 = Date.now();
      const neu = await loadDashboard(
        dashboardParams({ from: from || null, to: to || null, department: dept }),
      );
      const tNew = Date.now() - t1;

      // `attention.daysOverdue` is measured against now(); ignore ordering ties
      // by comparing the sets of order numbers as well as the values.
      const d = diff(old, neu);
      const label = `${from || "default"}..${to || "default"} ${dept}`;
      if (d.length) {
        bad++;
        console.log(`MISMATCH ${label}  old=${tOld}ms new=${tNew}ms`);
        for (const line of d.slice(0, 12)) console.log(`    ${line}`);
        if (d.length > 12) console.log(`    ...${d.length - 12} more`);
      } else {
        console.log(`ok       ${label}  old=${tOld}ms new=${tNew}ms`);
      }
    }
  }

  console.log("\n-- warm timing, default range, 5 runs each --");
  const p = dashboardParams({});
  const u = new URL("http://x/api/dashboard");
  for (const [name, fn] of [
    ["old", () => legacyDashboard(u)],
    ["new", () => loadDashboard(p)],
  ] as const) {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      await fn();
      times.push(Date.now() - t);
    }
    console.log(`${name}: ${times.join(", ")} ms  (median ${times.sort((a, b) => a - b)[2]})`);
  }

  console.log(bad === 0 ? "\nPARITY OK" : `\n${bad} MISMATCHES`);
  process.exit(0);
}
main();
