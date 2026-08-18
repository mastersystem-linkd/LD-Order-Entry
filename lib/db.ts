// The ONLY place the app connects to the database (CLAUDE.md §8).
// Supabase Postgres via postgres.js. Neon needed TWO drivers — HTTP for reads,
// a WebSocket pool for transactions — because its HTTP driver can't hold a
// transaction across awaits. postgres.js does both, so `db` and `dbx` are now
// the same instance; `dbx` stays exported as an alias so the six transaction
// call sites (orders create/edit/cancel/delete, stages recompute, workflow.ts)
// need no changes.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (see .env.example).",
  );
}

// DATABASE_URL points at Supabase's Supavisor pooler in TRANSACTION mode
// (port 6543) — the only option that is both IPv4-reachable and safe for
// Vercel's serverless functions. `prepare: false` is REQUIRED there: the pooler
// hands a different backend connection to each transaction, so server-side
// prepared statements can't be reused and postgres.js must not try to.
// Schema DDL uses DIRECT_URL instead (see drizzle.config.ts).
// Guard against the failure that took production down once already: pointing
// DATABASE_URL at Supabase's SESSION pooler (5432) instead of the TRANSACTION
// pooler (6543). Session mode holds one backend connection per client for its
// whole lifetime, and the Micro compute allows only 15 — so a handful of warm
// serverless instances exhaust the pool and every query fails with
// "max clients reached in session mode". The symptom (a generic 500 from every
// route) says nothing about the cause, so say it loudly at startup instead.
if (/:5432\//.test(process.env.DATABASE_URL) && process.env.NODE_ENV === "production") {
  console.error(
    "[db] DATABASE_URL uses port 5432 (session pooler). Production must use the " +
      "TRANSACTION pooler on port 6543 — session mode will exhaust the connection " +
      "pool and every query will fail. DIRECT_URL is the one that belongs on 5432.",
  );
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

// postgres.js pins a connection for the duration of an interactive transaction,
// which is exactly what applyStageProgress() and the order create/edit paths
// need — so the old two-client split is no longer necessary.
export const dbx = db;

export { schema };
