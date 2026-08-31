// What the Time-tracking SLA (workflow_stages.planned_offset_days) should be,
// measured against what actually happens. Read-only — prints, changes nothing.
//
//   npx tsx db/analyse-sla.ts
//
// ── Why this script exists ──────────────────────────────────────────────────
// The dashboard read 1% on-time (93 vs 7,117 late) and every CRM follow-up
// snapshotted system_on_time = false. Neither was a performance finding: five
// of the seven offsets were still the seed default of 1 day (db/seed.ts), so
// the SLA promised that stock checking, rolling, challan AND billing all
// finish the day the order is dated.
//
// ── The trap this script exists to avoid ────────────────────────────────────
// Measuring "days from order_date to actual_at" across ALL orders is
// MISLEADING. Every stage tick in this database happened in July–August 2026,
// when the app went live, but orders are dated from May. Orders predating
// go-live had their whole history ticked during onboarding, so they look
// 10–15 days late no matter how the business actually performed.
//
// So the headline table below is restricted to orders dated in the LAST FULL
// MONTH of data, where the order and its ticking are contemporaneous. The
// all-time column is printed beside it only to show how big the distortion is.
//
// ── Reading the result ──────────────────────────────────────────────────────
// An offset is a TARGET, not a description. Setting it to the observed median
// means half of all work is "late" by definition; setting it to p90 means
// almost nothing ever is, and the metric stops discriminating. p50 is a
// stretch, p75 is a realistic promise. Neither is a fact this script can
// derive — that is a commitment to customers, and it belongs to the business.
//
// Changing offsets affects NEW orders, and existing NOT-YET-DONE stages once
// Settings → Time tracking → "Recompute open orders" is pressed. It can never
// repair a done stage: delay_minutes is frozen at tick time (CLAUDE.md §12.3).
import "./load-env";
import postgres from "postgres";

const SCHEMA = process.env.DB_SCHEMA?.trim() || "ld_order_entry";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
  });
  const s = sql(SCHEMA);

  console.log(`Analysing SLA offsets in "${SCHEMA}"\n`);

  const [{ window_start }] = await sql<{ window_start: string }[]>`
    select to_char(date_trunc('month', max(order_date)), 'YYYY-MM-DD') as window_start
    from ${s}.customer_orders`;
  console.log(
    `Steady-state window: orders dated on/after ${window_start} ` +
      `(the last full month — see the note in this file about onboarding).\n`,
  );

  const rows = await sql`
    with d as (
      select sp.stage_key, o.order_date,
             extract(epoch from (sp.actual_at - o.order_date::timestamptz))/86400 as days
      from ${s}.line_stage_progress sp
      join ${s}.order_line_items li on li.id = sp.order_line_item_id
      join ${s}.customer_orders o on o.id = li.order_id
      where sp.is_done and sp.actual_at is not null
    )
    select ws.stage_key, ws.label, ws.planned_offset_days as configured,
      count(*) filter (where d.order_date >= ${window_start}::date) as n_recent,
      round((percentile_cont(0.5) within group (order by d.days)
        filter (where d.order_date >= ${window_start}::date))::numeric, 1) as p50,
      round((percentile_cont(0.75) within group (order by d.days)
        filter (where d.order_date >= ${window_start}::date))::numeric, 1) as p75,
      round((percentile_cont(0.9) within group (order by d.days)
        filter (where d.order_date >= ${window_start}::date))::numeric, 1) as p90,
      round((percentile_cont(0.5) within group (order by d.days))::numeric, 1) as p50_all_time
    from ${s}.workflow_stages ws
    left join d on d.stage_key = ws.stage_key
    group by ws.stage_key, ws.label, ws.planned_offset_days, ws.sort_order
    order by ws.sort_order`;

  console.table(
    rows.map((r) => ({
      stage: r.label,
      configured: r.configured,
      ticked: Number(r.n_recent),
      "p50 (stretch)": r.p50,
      "p75 (realistic)": r.p75,
      p90: r.p90,
      "p50 all-time": r.p50_all_time,
    })),
  );

  // What the current config actually scores, so "1% on time" has a cause
  // rather than being a number on a gauge.
  const [score] = await sql`
    select count(*) filter (where is_done) as done,
           count(*) filter (where is_done and coalesce(delay_minutes,0) <= 0) as on_time
    from ${s}.line_stage_progress`;
  const pct = (Number(score.on_time) / Math.max(1, Number(score.done))) * 100;
  console.log(
    `\nAgainst the CURRENT config: ${score.on_time} of ${score.done} done stages ` +
      `are on time (${pct.toFixed(1)}%).`,
  );
  console.log(
    "Note: these delay_minutes are frozen at tick time. Changing the offsets " +
      "cannot move this number — only new work is measured against a new SLA.",
  );

  await sql.end();
}

main().catch((e) => {
  console.error("analyse-sla failed:", e);
  process.exit(1);
});
