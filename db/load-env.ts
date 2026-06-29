// Side-effect module: load environment for standalone scripts (seed, drizzle-kit).
// Next.js loads .env.local automatically at runtime, but plain Node/tsx scripts do not.
// Import this FIRST, before any module that reads process.env (e.g. lib/db.ts).
import { config } from "dotenv";

// .env.local takes precedence; fall back to .env for anything unset.
config({ path: ".env.local" });
config();
