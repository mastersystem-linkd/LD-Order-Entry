-- OE: remove the MANAGER role. It was added in 0003 but its Access-matrix
-- grants ended up identical to ADMIN's, so it was a duplicate access level with
-- no distinct meaning. Roles are now ADMIN | SALES | OPS | VIEWER.
--
-- Postgres has no `ALTER TYPE ... DROP VALUE`, so the enum is recreated. Run
-- this DIRECTLY against Neon (SQL editor / psql) — see the migration note in
-- CLAUDE.md; `db:migrate` cannot replay this project's history. Idempotent: the
-- guard on the first statement makes a re-run a no-op.
--
-- APPLY TO BOTH the dev DB and production BEFORE deploying the code that drops
-- MANAGER from lib/rbac.ts, or a leftover MANAGER user's session breaks.

DO $$
BEGIN
  -- Nothing to do if the value is already gone.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'MANAGER'
  ) THEN
    RETURN;
  END IF;

  -- Any remaining MANAGER account keeps the same effective access as OPS.
  UPDATE "users" SET "role" = 'OPS' WHERE "role" = 'MANAGER';
  DELETE FROM "role_permissions" WHERE "role" = 'MANAGER';

  -- Recreate user_role without MANAGER (order matches db/schema.ts).
  ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
  ALTER TYPE "public"."user_role" RENAME TO "user_role_old";
  CREATE TYPE "public"."user_role" AS ENUM ('ADMIN', 'SALES', 'OPS', 'VIEWER');
  ALTER TABLE "users"
    ALTER COLUMN "role" TYPE "public"."user_role"
    USING "role"::text::"public"."user_role";
  ALTER TABLE "role_permissions"
    ALTER COLUMN "role" TYPE "public"."user_role"
    USING "role"::text::"public"."user_role";
  ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'VIEWER';
  DROP TYPE "public"."user_role_old";
END
$$;
