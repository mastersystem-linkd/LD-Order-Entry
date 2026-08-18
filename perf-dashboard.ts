import "./db/load-env";
import postgres from "postgres";

const url = process.env.DATABASE_URL!;
const SCHEMA = process.env.PERF_SCHEMA || process.env.DB_SCHEMA || "ld_order_entry";
console.log("schema:", SCHEMA);
const sqlc = postgres(url, { prepare: false, max: 5, idle_timeout: 5, connect_timeout: 10, connection: { search_path: SCHEMA } });

const to = new Date().toISOString().slice(0, 10);
const dd = new Date();
dd.setUTCDate(dd.getUTCDate() - 29);
const from = dd.toISOString().slice(0, 10);

async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : 1;
    console.log(`${String(Date.now() - t0).padStart(6)} ms  rows=${String(n).padStart(6)}  ${name}`);
    return r;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
    return undefined as unknown as T;
  }
}

async function main() {
  await time("connect + select 1", () => sqlc`select 1`);
  await time("ping #2", () => sqlc`select 1`);
  await time("ping #3", () => sqlc`select 1`);

  console.log("\n-- table sizes --");
  const counts = await sqlc`
    select 'customer_orders' as t, count(*) as n from customer_orders
    union all select 'order_line_items', count(*) from order_line_items
    union all select 'line_stage_progress', count(*) from line_stage_progress
    union all select 'workflow_stages', count(*) from workflow_stages`;
  console.log(counts.map((r: any) => `${r.t}: ${r.n}`).join("\n"));

  console.log(`\n-- dashboard queries (range ${from} .. ${to}) --`);

  await time("1  stages", () => sqlc`select stage_key, label, sort_order from workflow_stages order by sort_order`);

  await time("2  lineRows (per-line progress)", () => sqlc`
    select oli.order_id, co.order_no, co.party_name, co.order_date, oli.line_total,
           count(*) filter (where lsp.is_done) as done_count,
           min(ws.sort_order) filter (where lsp.is_done = false) as current_sort
      from order_line_items oli
      join customer_orders co on co.id = oli.order_id
      join line_stage_progress lsp on lsp.order_line_item_id = oli.id
      join workflow_stages ws on ws.stage_key = lsp.stage_key
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
     group by oli.id, co.id`);

  await time("3  onTime agg", () => sqlc`
    select count(*) as done, count(*) filter (where coalesce(lsp.delay_minutes,0) <= 0) as on_time
      from line_stage_progress lsp
      join order_line_items oli on oli.id = lsp.order_line_item_id
      join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false and lsp.is_done = true`);

  await time("4  ordersByDay (EXISTS visible line)", () => sqlc`
    select co.order_date as d, count(*) as n from customer_orders co
     where co.order_date >= ${from} and co.order_date <= ${to}
       and exists (select 1 from order_line_items oli where oli.order_id = co.id and oli.is_deleted = false)
     group by co.order_date`);

  await time("5  valueByDay", () => sqlc`
    select co.order_date as d, coalesce(sum(oli.line_total),0) as v
      from order_line_items oli join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
     group by co.order_date`);

  await time("6  topParties", () => sqlc`
    select co.party_name, count(distinct co.id) as o, coalesce(sum(oli.line_total),0) as v
      from order_line_items oli join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
     group by co.party_name order by v desc limit 6`);

  await time("7  topFabrics", () => sqlc`
    select oli.quality, coalesce(sum(oli.qty_mtr),0) as m
      from order_line_items oli join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
     group by oli.quality order by m desc limit 6`);

  await time("8  overdueRows (ALL overdue stage rows)", () => sqlc`
    select co.id, co.order_no, co.party_name, ws.label, lsp.planned_at
      from line_stage_progress lsp
      join order_line_items oli on oli.id = lsp.order_line_item_id
      join customer_orders co on co.id = oli.order_id
      join workflow_stages ws on ws.stage_key = lsp.stage_key
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
       and lsp.is_done = false and lsp.planned_at < now()`);

  await time("9  totals.orderCount", () => sqlc`
    select count(*) as n from customer_orders co
     where co.order_date >= ${from} and co.order_date <= ${to}
       and exists (select 1 from order_line_items oli where oli.order_id = co.id and oli.is_deleted = false)`);

  await time("10 totals.valueMeters", () => sqlc`
    select coalesce(sum(oli.line_total),0) as v, coalesce(sum(oli.qty_mtr),0) as m
      from order_line_items oli join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false`);

  await time("11 cancelAgg", () => sqlc`
    select oli.order_id, count(*) as t, count(*) filter (where oli.is_cancelled) as c
      from order_line_items oli join customer_orders co on co.id = oli.order_id
     where co.order_date >= ${from} and co.order_date <= ${to} and oli.is_deleted = false
     group by oli.order_id`);

  await time("12 trashAgg (GLOBAL, no range filter)", () => sqlc`
    select order_id, count(*) as t, count(*) filter (where is_deleted) as d
      from order_line_items group by order_id`);

  console.log("\n-- EXPLAIN ANALYZE: lineRows --");
  const ex = await sqlc`
    explain (analyze, buffers, timing)
    select oli.order_id, co.order_no,
           count(*) filter (where lsp.is_done) as done_count,
           min(ws.sort_order) filter (where lsp.is_done = false) as current_sort
      from order_line_items oli
      join customer_orders co on co.id = oli.order_id
      join line_stage_progress lsp on lsp.order_line_item_id = oli.id
      join workflow_stages ws on ws.stage_key = lsp.stage_key
     where co.order_date >= ${from} and co.order_date <= ${to}
       and oli.is_cancelled = false and oli.is_deleted = false
     group by oli.id, co.id`;
  console.log(ex.map((r: any) => r["QUERY PLAN"]).join("\n"));

  await sqlc.end();
}
main();
