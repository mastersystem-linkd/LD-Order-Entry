// Copy the live order book into the LOCAL DEV schema so `npm run dev` has
// something real to show. CLAUDE.md forbids pointing local dev at production,
// and `ld_order_entry_dev` starts empty, so a dev server otherwise renders a
// blank app and every screen looks broken.
//
// Reads production, writes ONLY into the dev schema, and is re-runnable:
// everything is ON CONFLICT DO NOTHING. Refuses to run if the two schemas are
// the same name, which would mean writing to production.
import "./load-env";
import postgres from "postgres";

const PROD = "ld_order_entry";
const DEV = process.env.DB_SCHEMA?.trim() || "ld_order_entry_dev";

if (DEV === PROD) {
  console.error(
    `Refusing to run: DB_SCHEMA is "${DEV}", which is production. Set it to a dev schema.`,
  );
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});

// Child tables last — foreign keys point back up this list.
const TABLES = [
  "customer_orders",
  "order_line_items",
  "line_stage_progress",
  "lookup_values",
] as const;

async function main() {
  console.log(`copying ${PROD} → ${DEV}\n`);

  for (const t of TABLES) {
    // Copy by explicit column list: relying on `SELECT *` would silently
    // mis-map if the two schemas ever drift in column order.
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = ${DEV} and table_name = ${t}
         and is_generated = 'NEVER'
       order by ordinal_position`;
    if (cols.length === 0) {
      console.log(`  ${t.padEnd(20)} SKIPPED — no such table in ${DEV}`);
      continue;
    }
    const list = cols.map((c) => `"${c.column_name}"`).join(", ");

    const t0 = Date.now();
    const res = await sql.unsafe(
      `insert into "${DEV}"."${t}" (${list})
       select ${list} from "${PROD}"."${t}"
       on conflict do nothing`,
    );
    const [{ n }] = await sql.unsafe(
      `select count(*)::int as n from "${DEV}"."${t}"`,
    );
    console.log(
      `  ${t.padEnd(20)} +${String(res.count).padStart(6)} rows → ${n} total (${Date.now() - t0} ms)`,
    );
  }

  await sql.end();
  console.log("\ndone — dev schema now mirrors production for read-only testing");
  process.exit(0);
}
main();
