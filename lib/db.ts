// The ONLY place the app connects to the database (CLAUDE.md §8).
// Two Neon clients, both via Drizzle, both from @neondatabase/serverless:
//   - `db`  : HTTP driver — fast & stateless, for reads and simple writes.
//   - `dbx` : WebSocket pool — required for interactive transactions
//             (the HTTP driver can't hold a transaction across awaits).
import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import ws from "ws";

import * as schema from "@/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (see .env.example).",
  );
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });

// Pool is lazy — it only opens a socket the first time a transaction runs, so
// importing this module stays cheap for read-only/HTTP paths.
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const dbx = drizzlePool(pool, { schema });

export { schema };
