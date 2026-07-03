-- OE: add the MANAGER role (orders + operations, no settings) to the enum.
-- NOTE: Postgres `ALTER TYPE ... ADD VALUE` cannot run inside a transaction,
-- so drizzle-kit migrate can't apply this. Run it DIRECTLY (Neon SQL editor /
-- psql autocommit). Idempotent via IF NOT EXISTS.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'MANAGER';
