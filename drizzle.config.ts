import "./db/load-env";
// Must come before drizzle-kit loads db/schema.ts — see the file for why.
import "./db/force-prod-schema";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // DDL must NOT go through the transaction pooler — use Supabase's direct
    // (session) connection on port 5432. Falls back to DATABASE_URL locally.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
  // CRITICAL: the LD Silk Mills Supabase project is shared with other apps.
  // Without this fence drizzle-kit introspects every schema it can reach, finds
  // tables that aren't in db/schema.ts, and proposes to DROP them.
  schemaFilter: ["ld_order_entry"],
  strict: true,
  verbose: true,
});
