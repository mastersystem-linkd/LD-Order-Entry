// End-to-end write test against whatever DATABASE_URL points at.
//
// Reads were obviously fine after the Supabase cutover — the dashboard rendered.
// Writes are a different code path: an interactive transaction, which is exactly
// what broke under Neon (the ws/bufferutil bug), and where the boolean coercion
// bug corrupted the migration. This exercises that path for real and then
// removes everything it created, so it is safe to run against production.
//
//   npx tsx db/verify-write-path.ts
import "./load-env";

import { and, count, eq } from "drizzle-orm";

import { db, dbx } from "@/lib/db";
import {
  applyStageProgress,
  buildInitialStageRows,
  computeLineStatus,
  WorkflowError,
} from "@/lib/workflow";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

const ORDER_NO = `ZZ-SMOKE-${Date.now()}`;
let fails = 0;
let orderId: string | null = null;

function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) fails++;
}

async function totals() {
  const [[o], [l], [s]] = await Promise.all([
    db.select({ n: count() }).from(customerOrders),
    db.select({ n: count() }).from(orderLineItems),
    db.select({ n: count() }).from(lineStageProgress).where(eq(lineStageProgress.isDone, true)),
  ]);
  return { orders: Number(o.n), lines: Number(l.n), done: Number(s.n) };
}

async function main() {
  const before = await totals();
  console.log(`Before: ${before.orders} orders / ${before.lines} lines / ${before.done} stages done\n`);

  // ---- create: one header + 2 lines + 7 stage rows each, in ONE transaction --
  console.log("Write path:");
  const offRows = await db
    .select({ stageKey: workflowStages.stageKey, off: workflowStages.plannedOffsetDays })
    .from(workflowStages);
  const offsets = Object.fromEntries(offRows.map((r) => [r.stageKey, r.off]));
  check("workflow_stages readable", offRows.length === 7, `got ${offRows.length}`);

  const lineIds = await dbx.transaction(async (tx) => {
    const [created] = await tx
      .insert(customerOrders)
      .values({
        orderNo: ORDER_NO,
        orderDate: "2026-08-18",
        partyName: "SMOKE TEST — delete me",
        department: "LD",
        createdBy: "verify-write-path",
      })
      .returning({ id: customerOrders.id });
    orderId = created.id;

    const lines = await tx
      .insert(orderLineItems)
      .values([
        { orderId: created.id, quality: "SmokeFabric", designNo: "SMOKE-1", qtyMtr: "10.50", rate: "20.00" },
        { orderId: created.id, quality: "SmokeFabric", designNo: "SMOKE-2", qtyMtr: "5.25", rate: "20.00" },
      ])
      .returning({ id: orderLineItems.id });

    await tx.insert(lineStageProgress).values(
      lines.flatMap((l) => buildInitialStageRows(l.id, "2026-08-18", offsets)),
    );
    return lines.map((l) => l.id);
  });
  check("transaction committed (order + 2 lines)", lineIds.length === 2);

  const [{ n: stageRows }] = await db
    .select({ n: count() })
    .from(lineStageProgress)
    .where(eq(lineStageProgress.orderLineItemId, lineIds[0]));
  check("7 stage rows seeded per line", Number(stageRows) === 7, `got ${stageRows}`);

  // ---- generated column ----------------------------------------------------
  const [line0] = await db
    .select({ total: orderLineItems.lineTotal })
    .from(orderLineItems)
    .where(eq(orderLineItems.id, lineIds[0]));
  check("line_total generated (10.50 x 20.00 = 210.00)", Number(line0.total) === 210, `got ${line0.total}`);

  // ---- the stock gate ------------------------------------------------------
  await applyStageProgress({ orderLineItemId: lineIds[0], stageKey: "order_entry", isDone: true });
  const [oe] = await db
    .select({ done: lineStageProgress.isDone, actual: lineStageProgress.actualAt })
    .from(lineStageProgress)
    .where(and(eq(lineStageProgress.orderLineItemId, lineIds[0]), eq(lineStageProgress.stageKey, "order_entry")));
  // The boolean bug during the migration wrote FALSE here without erroring.
  check("order_entry is_done persisted as TRUE", oe.done === true, `got ${oe.done}`);
  check("actual_at stamped", oe.actual != null);

  let blocked = false;
  try {
    await applyStageProgress({ orderLineItemId: lineIds[0], stageKey: "challan", isDone: true });
  } catch (e) {
    blocked = e instanceof WorkflowError;
  }
  check("downstream stage blocked while out of stock", blocked);

  await applyStageProgress({
    orderLineItemId: lineIds[0], stageKey: "stock_checking", isDone: true, stockStatus: "in_stock",
  });
  await applyStageProgress({ orderLineItemId: lineIds[0], stageKey: "challan", isDone: true });
  const stages = await db
    .select({ stageKey: lineStageProgress.stageKey, isDone: lineStageProgress.isDone })
    .from(lineStageProgress)
    .where(eq(lineStageProgress.orderLineItemId, lineIds[0]));
  check("challan unlocked once in stock", stages.find((s) => s.stageKey === "challan")?.isDone === true);
  check("line status = PARTIALLY COMPLETED", computeLineStatus(stages) === "PARTIALLY COMPLETED",
    computeLineStatus(stages));

  // ---- cancel + soft delete flags -----------------------------------------
  await db.update(orderLineItems).set({ isCancelled: true }).where(eq(orderLineItems.id, lineIds[1]));
  const [flagged] = await db
    .select({ c: orderLineItems.isCancelled })
    .from(orderLineItems)
    .where(eq(orderLineItems.id, lineIds[1]));
  check("is_cancelled persisted as TRUE", flagged.c === true, `got ${flagged.c}`);
}

async function cleanup() {
  if (!orderId) return;
  await db.delete(customerOrders).where(eq(customerOrders.id, orderId));
  const [gone] = await db
    .select({ n: count() })
    .from(customerOrders)
    .where(eq(customerOrders.orderNo, ORDER_NO));
  check("test order removed (cascade)", Number(gone.n) === 0);
}

main()
  .catch((e) => {
    console.error("\nUNEXPECTED ERROR:", e instanceof Error ? e.message : e);
    fails++;
  })
  .then(async () => {
    console.log("\nCleanup:");
    await cleanup().catch((e) => {
      fails++;
      console.error(`  FAIL could not clean up order ${ORDER_NO} — REMOVE IT MANUALLY:`, e);
    });
    const after = await totals();
    console.log(`\nAfter: ${after.orders} orders / ${after.lines} lines / ${after.done} stages done`);
    console.log(
      fails === 0
        ? "\nWrite path verified. Database left exactly as found."
        : `\n${fails} CHECK(S) FAILED.`,
    );
    process.exit(fails === 0 ? 0 : 1);
  });
