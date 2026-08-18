// One-off data copy: Neon `public` (PG 18.4) -> Supabase `ld_order_entry` (PG 17.6).
//
// pg_dump cannot be used here: Postgres restores forwards only, and the source
// is a MAJOR VERSION AHEAD of the target. So the structure comes from
// db/migrations/0000_*.sql (generated from db/schema.ts) and this script moves
// only the rows, which are version-agnostic.
//
// Date/time columns are read as TEXT in UTC, because postgres.js would
// otherwise return them as JS Dates and silently truncate Postgres's
// microseconds to milliseconds. Everything else is passed through in its native
// form — postgres.js already returns numeric and uuid as strings, so precision
// is safe, and casting a boolean to text makes Postgres store FALSE with no
// error at all (which is exactly what went wrong on the first run).
//
// Safe to re-run — it truncates the target first. Run it once to rehearse, then
// again during the cutover window.
//
//   npx tsx db/copy-to-supabase.ts
import "./load-env";
import postgres from "postgres";

const SOURCE = process.env.MIGRATE_SOURCE_URL;
const TARGET = process.env.MIGRATE_TARGET_URL;

if (!SOURCE || !TARGET) {
  console.error(
    "Set both in .env.local:\n" +
      "  MIGRATE_SOURCE_URL  = the Neon connection string (the CURRENT production DB)\n" +
      "  MIGRATE_TARGET_URL  = the Supabase DIRECT connection string (port 5432)",
  );
  process.exit(1);
}
if (!TARGET.includes("supabase")) {
  console.error("Refusing to run: MIGRATE_TARGET_URL is not a Supabase connection string.");
  process.exit(1);
}
if (SOURCE === TARGET) {
  console.error("Refusing to run: source and target are the same database.");
  process.exit(1);
}
// The cutover happened on 2026-08-18: ld_order_entry is now the LIVE database.
// This script TRUNCATES the target before loading, so a stray re-run would wipe
// production and reload it from a frozen Neon, destroying everything entered
// since. The migration is finished — running this again is almost certainly a
// mistake, so make it impossible to do by accident.
if (process.env.MIGRATE_ALLOW_WIPE !== "yes") {
  console.error(
    "Refusing to run: this TRUNCATES the target schema before loading, and\n" +
      "ld_order_entry is live production since the 2026-08-18 cutover.\n" +
      "If you really mean to wipe and reload it, set MIGRATE_ALLOW_WIPE=yes.",
  );
  process.exit(1);
}

const SRC = "public";
const DST = "ld_order_entry";
// 500 rows x at most 15 columns stays well under Postgres's 65535 parameter cap.
const BATCH = 500;

// FK dependency order — parents before children.
// `line_total` is deliberately ABSENT from order_line_items: it is a GENERATED
// column, cannot be written to, and Postgres recomputes it from qty_mtr * rate.
// Columns are listed explicitly on both sides because physical column order
// differs between the two databases (is_deleted was appended by migration 0005
// on Neon, but sits mid-table in the regenerated schema).
// `fpExtra` = columns not copied but still compared in the fingerprint pass.
// line_total is GENERATED, so Postgres recomputes it on the target — comparing
// it proves the recomputation produced identical values, rupee for rupee.
const TABLES: { name: string; cols: string[]; fpExtra?: string[] }[] = [
  { name: "workflow_stages", cols: ["stage_key", "label", "sort_order", "planned_offset_days"] },
  { name: "users", cols: ["id", "email", "password_hash", "name", "role", "is_active", "created_at"] },
  { name: "role_permissions", cols: ["id", "role", "capability", "allowed", "updated_at"] },
  { name: "lookup_values", cols: ["id", "category", "value", "is_active"] },
  {
    name: "customer_orders",
    cols: ["id", "order_no", "order_date", "party_name", "sales_person", "agent", "haste",
      "transport", "challan_no", "lot_no", "department", "remarks", "created_by",
      "created_at", "updated_at"],
  },
  {
    name: "order_line_items",
    cols: ["id", "order_id", "quality", "design_no", "qty_mtr", "rate", "is_cancelled",
      "is_deleted", "remarks", "created_at", "updated_at"],
    fpExtra: ["line_total"],
  },
  {
    name: "line_stage_progress",
    cols: ["id", "order_line_item_id", "stage_key", "planned_at", "actual_at", "is_done",
      "delay_minutes", "stock_status", "updated_by", "updated_at"],
  },
  { name: "design_database", cols: ["id", "created_at", "order_id", "order_no", "fabric_name", "design_no"] },
];

// The same audit query run against both databases. Deliberately timezone-proof
// and value-based, not just row counts: if a single line item went missing the
// metre and rupee totals would move.
const audit = (schema: string) => `
  select 'users' t, count(*)::text v from "${schema}"."users"
  union all select 'role_permissions',    count(*)::text from "${schema}"."role_permissions"
  union all select 'customer_orders',     count(*)::text from "${schema}"."customer_orders"
  union all select 'order_line_items',    count(*)::text from "${schema}"."order_line_items"
  union all select 'workflow_stages',     count(*)::text from "${schema}"."workflow_stages"
  union all select 'line_stage_progress', count(*)::text from "${schema}"."line_stage_progress"
  union all select 'design_database',     count(*)::text from "${schema}"."design_database"
  union all select 'lookup_values',       count(*)::text from "${schema}"."lookup_values"
  union all select 'SUM qty_mtr',    coalesce(sum(qty_mtr),0)::text    from "${schema}"."order_line_items"
  union all select 'SUM line_total', coalesce(sum(line_total),0)::text from "${schema}"."order_line_items"
  union all select 'stages done',     count(*)::text from "${schema}"."line_stage_progress" where is_done
  union all select 'cancelled lines', count(*)::text from "${schema}"."order_line_items" where is_cancelled
  union all select 'deleted lines',   count(*)::text from "${schema}"."order_line_items" where is_deleted
  union all select 'last order update',
    (select max(updated_at) at time zone 'UTC' from "${schema}"."customer_orders")::text
  order by 1`;

const opts = { ssl: "require" as const, max: 1, prepare: false, idle_timeout: 20 };
const src = postgres(SOURCE, opts);
const dst = postgres(TARGET, opts);

async function main() {
  await src.unsafe("set time zone 'UTC'");
  await dst.unsafe("set time zone 'UTC'");

  console.log("Clearing target schema…");
  await dst.unsafe(
    `truncate ${TABLES.map((t) => `"${DST}"."${t.name}"`).join(", ")} cascade`,
  );

  console.log("\nCopying:");
  for (const t of TABLES) {
    // ---- Why every column is read AND written as text -----------------------
    // postgres.js re-serialises each parameter using the type the SERVER infers
    // for it, and that coercion is lossy in both directions:
    //   * a string bound to a timestamptz parameter goes through new Date(),
    //     truncating Postgres microseconds to milliseconds;
    //   * the string 'true' bound to a boolean parameter fails its `=== true`
    //     check and is written as FALSE, silently and without any error.
    // Both were observed on real runs of this script.
    //
    // The cure is to give postgres.js nothing to guess about: select every
    // column ::text, and bind every placeholder as $n::text::<column type> so
    // Postgres itself performs every conversion, server-side, exactly as if the
    // value had been typed into psql.
    const typeRows = await src.unsafe(
      `select column_name, data_type, udt_name from information_schema.columns
        where table_schema = $1 and table_name = $2`,
      [SRC, t.name] as never[],
    );
    const castTo = new Map(
      typeRows.map((r) => [
        r.column_name as string,
        // The enum is schema-scoped, so it must be qualified with the TARGET
        // schema, not the source's.
        r.data_type === "USER-DEFINED"
          ? `"${DST}"."${r.udt_name}"`
          : (r.data_type as string),
      ]),
    );
    const missing = t.cols.filter((c) => !castTo.has(c));
    if (missing.length) {
      throw new Error(`${t.name}: could not resolve types for ${missing.join(", ")}`);
    }

    const selectList = t.cols.map((c) => `"${c}"::text as "${c}"`).join(", ");
    const rows = await src.unsafe(`select ${selectList} from "${SRC}"."${t.name}"`);

    const colList = t.cols.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const placeholders = chunk
        .map(
          (_, r) =>
            `(${t.cols
              .map((c, ci) => `$${r * t.cols.length + ci + 1}::text::${castTo.get(c)}`)
              .join(",")})`,
        )
        .join(",");
      const values = chunk.flatMap((row) => t.cols.map((c) => (row as Record<string, unknown>)[c]));
      await dst.unsafe(
        `insert into "${DST}"."${t.name}" (${colList}) values ${placeholders}`,
        values as never[],
      );
    }

    const [{ n }] = await dst.unsafe(
      `select count(*)::int as n from "${DST}"."${t.name}"`,
    );
    const ok = Number(n) === rows.length;
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${t.name.padEnd(22)} ${String(rows.length).padStart(6)} read` +
        `  ->${String(n).padStart(6)} written`,
    );
  }

  console.log("\nAudit — Neon vs Supabase:");
  const [a, b] = await Promise.all([
    src.unsafe(audit(SRC)),
    dst.unsafe(audit(DST)),
  ]);
  const bMap = new Map(b.map((r) => [r.t as string, r.v as string]));

  let mismatches = 0;
  for (const row of a) {
    const neon = row.v as string;
    const supa = bMap.get(row.t as string) ?? "(missing)";
    const same = neon === supa;
    if (!same) mismatches++;
    console.log(
      `  ${same ? "OK  " : "DIFF"} ${(row.t as string).padEnd(20)} ${neon.padStart(24)}  |  ${supa}`,
    );
  }

  // Totals prove nothing was lost. Fingerprints prove nothing was scrambled:
  // every field of every row, hashed in a fixed column and row order on both
  // sides. NULLs are coalesced to a sentinel so a NULL can't masquerade as an
  // empty string, and timestamps render in UTC on both sessions.
  console.log("\nRow fingerprints (every field of every row):");
  for (const t of TABLES) {
    const cols = [...t.cols, ...(t.fpExtra ?? [])];
    const order = t.cols.includes("id") ? '"id"' : '"stage_key"';
    const parts = cols.map((c) => `coalesce("${c}"::text,'~NULL~')`).join(", ");
    const fp = (s: string) =>
      `select coalesce(md5(string_agg(concat_ws('|', ${parts}), chr(10) order by ${order})),'empty') as fp` +
      ` from "${s}"."${t.name}"`;
    const [[x], [y]] = await Promise.all([
      src.unsafe(fp(SRC)),
      dst.unsafe(fp(DST)),
    ]);
    const same = x.fp === y.fp;
    if (!same) mismatches++;
    console.log(`  ${same ? "OK  " : "DIFF"} ${t.name.padEnd(22)} ${x.fp}`);
  }

  console.log(
    mismatches === 0
      ? "\nEvery total and every row hash matches. Copy verified."
      : `\n${mismatches} MISMATCH(ES). Do NOT cut over — investigate first.`,
  );
  return mismatches;
}

main()
  .then(async (m) => {
    await src.end();
    await dst.end();
    process.exit(m === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("\nCopy failed:", err);
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
    process.exit(1);
  });
