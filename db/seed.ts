// Idempotent seed (CLAUDE.md OE-P0): 7 workflow stages, a few lookups per
// category, one ADMIN user. Safe to re-run — nothing is duplicated. No orders.
import "./load-env";

import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import {
  lookupValues,
  users,
  workflowStages,
  type LookupCategory,
} from "@/db/schema";

const STAGES: { stageKey: string; label: string; sortOrder: number }[] = [
  { stageKey: "order_entry", label: "Order Entry", sortOrder: 1 },
  { stageKey: "stock_checking", label: "Stock Checking", sortOrder: 2 },
  { stageKey: "rolling_checking", label: "Rolling & Checking", sortOrder: 3 },
  { stageKey: "challan", label: "Challan", sortOrder: 4 },
  { stageKey: "bill", label: "Bill", sortOrder: 5 },
  { stageKey: "dispatch", label: "Dispatch", sortOrder: 6 },
  { stageKey: "received_lr", label: "Received LR", sortOrder: 7 },
];

const LOOKUPS: Record<LookupCategory, string[]> = {
  PARTY: ["Shree Textiles", "Krishna Fabrics", "Rajesh Traders"],
  SALES_PERSON: ["Amit Shah", "Priya Nair", "Sunil Mehta"],
  AGENT: ["Mahesh Agency", "Verma Brothers"],
  HASTE: ["Urgent", "Normal", "Low"],
  TRANSPORT: ["VRL Logistics", "Gati", "Self Pickup"],
  FABRIC: ["Cotton", "Silk", "Georgette", "Chiffon", "Rayon"],
};

async function seedStages() {
  await db.insert(workflowStages).values(STAGES).onConflictDoNothing();
  const [{ value }] = await db
    .select({ value: count() })
    .from(workflowStages);
  console.log(`  workflow_stages: ${value} rows`);
}

async function seedLookups() {
  const existing = await db
    .select({ category: lookupValues.category, value: lookupValues.value })
    .from(lookupValues);
  const seen = new Set(existing.map((r) => `${r.category}::${r.value}`));

  const toInsert: { category: string; value: string }[] = [];
  for (const [category, values] of Object.entries(LOOKUPS)) {
    for (const value of values) {
      if (!seen.has(`${category}::${value}`)) toInsert.push({ category, value });
    }
  }
  if (toInsert.length > 0) {
    await db.insert(lookupValues).values(toInsert);
  }
  const [{ value }] = await db.select({ value: count() }).from(lookupValues);
  console.log(`  lookup_values:   ${value} rows (+${toInsert.length} new)`);
}

async function seedAdmin() {
  const email = normalizeEmail(
    process.env.SEED_ADMIN_EMAIL ?? "admin@ldorderentry.local",
  );
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const name = process.env.SEED_ADMIN_NAME ?? "Administrator";

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));

  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({
      email,
      name,
      role: "ADMIN",
      passwordHash,
      isActive: true,
    });
    console.log(`  users:           seeded ADMIN ${email} / ${password}`);
  } else {
    console.log(`  users:           ADMIN ${email} already present`);
  }
}

async function main() {
  console.log("Seeding database…");
  await seedStages();
  await seedLookups();
  await seedAdmin();
  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
