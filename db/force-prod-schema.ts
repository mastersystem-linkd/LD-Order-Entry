// Imported by drizzle.config.ts BEFORE drizzle-kit loads db/schema.ts.
//
// Migration files are committed and applied to production, so they must always
// be generated against the production schema name. Without this, running
// `db:generate` on a machine with DB_SCHEMA=ld_order_entry_dev would bake the
// dev schema into a migration and ship it.
process.env.DB_SCHEMA = "ld_order_entry";
