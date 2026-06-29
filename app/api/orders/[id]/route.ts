import { asc, eq, inArray } from "drizzle-orm";

import {
  isUniqueViolation,
  jsonData,
  jsonError,
  requireRole,
} from "@/lib/api";
import { db, dbx } from "@/lib/db";
import { ROLES } from "@/lib/rbac";
import { firstZodError, orderPayloadSchema } from "@/lib/validation";
import {
  buildInitialStageRows,
  computeLineStatus,
  computeOrderStatus,
  lineMatchKey,
} from "@/lib/workflow";
import {
  customerOrders,
  designDatabase,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

// GET /api/orders/:id — header + reconstructed fabric blocks + lines with status.
export async function GET(_req: Request, { params }: Params) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const [order] = await db
    .select()
    .from(customerOrders)
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!order) return jsonError("Order not found", 404);

  const lines = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, id))
    .orderBy(asc(orderLineItems.createdAt));

  const lineIds = lines.map((l) => l.id);
  const stages = lineIds.length
    ? await db
        .select({
          lineId: lineStageProgress.orderLineItemId,
          isDone: lineStageProgress.isDone,
        })
        .from(lineStageProgress)
        .where(inArray(lineStageProgress.orderLineItemId, lineIds))
    : [];

  const stagesByLine = new Map<string, { isDone: boolean }[]>();
  for (const s of stages) {
    const arr = stagesByLine.get(s.lineId) ?? [];
    arr.push({ isDone: s.isDone });
    stagesByLine.set(s.lineId, arr);
  }

  const lineOut = lines.map((l) => ({
    id: l.id,
    quality: l.quality,
    design_no: l.designNo,
    qty_mtr: l.qtyMtr,
    rate: l.rate,
    line_total: l.lineTotal,
    is_cancelled: l.isCancelled,
    operations_status: computeLineStatus(stagesByLine.get(l.id) ?? []),
  }));

  // Rebuild fabric blocks for the edit form: group lines by fabric + rate.
  const fabricMap = new Map<
    string,
    { fabric: string; rate: number | null; designs: { design_no: string; qty_mtr: number }[] }
  >();
  for (const l of lines) {
    const key = `${l.quality}__${l.rate ?? ""}`;
    let block = fabricMap.get(key);
    if (!block) {
      block = { fabric: l.quality, rate: l.rate == null ? null : Number(l.rate), designs: [] };
      fabricMap.set(key, block);
    }
    block.designs.push({ design_no: l.designNo, qty_mtr: Number(l.qtyMtr) });
  }

  const active = lineOut.filter((l) => !l.is_cancelled);
  const qty_total = active.reduce((s, l) => s + Number(l.qty_mtr), 0);
  const grand_total = active.reduce((s, l) => s + Number(l.line_total ?? 0), 0);

  return jsonData({
    order: {
      id: order.id,
      order_no: order.orderNo,
      order_date: order.orderDate,
      party_name: order.partyName,
      sales_person: order.salesPerson,
      agent: order.agent,
      haste: order.haste,
      transport: order.transport,
      challan_no: order.challanNo,
      lot_no: order.lotNo,
      department: order.department,
      remarks: order.remarks,
      created_by: order.createdBy,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    },
    fabrics: [...fabricMap.values()],
    lines: lineOut,
    qty_total: Number(qty_total.toFixed(2)),
    grand_total: Number(grand_total.toFixed(2)),
    operations_status: computeOrderStatus(active.map((l) => l.operations_status)),
  });
}

// PUT /api/orders/:id — replace lines, preserving stage progress for lines that
// still match on (fabric + design + qty); fresh stage rows only for new lines.
export async function PUT(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN", "SALES"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = orderPayloadSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { order, fabrics } = parsed.data;
  const orderNo = order.order_no.trim();

  const [existing] = await db
    .select({ id: customerOrders.id, orderNo: customerOrders.orderNo })
    .from(customerOrders)
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!existing) return jsonError("Order not found", 404);

  if (orderNo !== existing.orderNo) {
    const [clash] = await db
      .select({ id: customerOrders.id })
      .from(customerOrders)
      .where(eq(customerOrders.orderNo, orderNo))
      .limit(1);
    if (clash) return jsonError(`Order number "${orderNo}" already exists.`, 409);
  }

  const now = new Date();
  try {
    await dbx.transaction(async (tx) => {
      const existingLines = await tx
        .select()
        .from(orderLineItems)
        .where(eq(orderLineItems.orderId, id));

      const byKey = new Map<string, typeof existingLines>();
      for (const l of existingLines) {
        const k = lineMatchKey({
          quality: l.quality,
          designNo: l.designNo,
          qtyMtr: l.qtyMtr,
        });
        const arr = byKey.get(k) ?? [];
        arr.push(l);
        byKey.set(k, arr);
      }

      const newLines = fabrics.flatMap((f) =>
        f.designs.map((d) => ({
          quality: f.fabric.trim(),
          designNo: d.design_no.trim(),
          qtyMtr: d.qty_mtr,
          rate: f.rate == null ? null : f.rate,
        })),
      );

      const keepIds = new Set<string>();
      const toInsert: typeof newLines = [];
      const toUpdateRate: { id: string; rate: string | null }[] = [];

      for (const nl of newLines) {
        const bucket = byKey.get(lineMatchKey(nl));
        if (bucket && bucket.length) {
          const match = bucket.shift()!;
          keepIds.add(match.id);
          const newRate = nl.rate == null ? null : String(nl.rate);
          const sameRate =
            (match.rate == null && newRate == null) ||
            (match.rate != null &&
              newRate != null &&
              Number(match.rate) === Number(newRate));
          if (!sameRate) toUpdateRate.push({ id: match.id, rate: newRate });
        } else {
          toInsert.push(nl);
        }
      }

      const toDelete = existingLines
        .filter((l) => !keepIds.has(l.id))
        .map((l) => l.id);
      if (toDelete.length) {
        await tx.delete(orderLineItems).where(inArray(orderLineItems.id, toDelete));
      }

      for (const u of toUpdateRate) {
        await tx
          .update(orderLineItems)
          .set({ rate: u.rate, updatedAt: now })
          .where(eq(orderLineItems.id, u.id));
      }

      if (toInsert.length) {
        const inserted = await tx
          .insert(orderLineItems)
          .values(
            toInsert.map((nl) => ({
              orderId: id,
              quality: nl.quality,
              designNo: nl.designNo,
              qtyMtr: String(nl.qtyMtr),
              rate: nl.rate == null ? null : String(nl.rate),
            })),
          )
          .returning({ id: orderLineItems.id });

        // SLA planned dates from the Time Tracking config — for new lines only.
        const offRows = await tx
          .select({
            stageKey: workflowStages.stageKey,
            off: workflowStages.plannedOffsetDays,
          })
          .from(workflowStages);
        const offsets = Object.fromEntries(
          offRows.map((r) => [r.stageKey, r.off]),
        );
        const stageValues = inserted.flatMap((l) =>
          buildInitialStageRows(l.id, order.order_date, offsets),
        );
        await tx.insert(lineStageProgress).values(stageValues);
      }

      // Design Database log for every current line (deduped; idempotent re-save).
      const seen = new Set<string>();
      const designRows = newLines.flatMap((nl) => {
        const key = `${nl.quality}__${nl.designNo}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            orderId: id,
            orderNo,
            fabricName: nl.quality,
            designNo: nl.designNo,
          },
        ];
      });
      if (designRows.length) {
        await tx.insert(designDatabase).values(designRows).onConflictDoNothing();
      }

      await tx
        .update(customerOrders)
        .set({
          orderNo,
          orderDate: order.order_date,
          partyName: order.party_name,
          salesPerson: order.sales_person,
          agent: order.agent,
          haste: order.haste,
          transport: order.transport,
          challanNo: order.challan_no,
          lotNo: order.lot_no,
          department: order.department?.trim() || "LD",
          remarks: order.remarks,
          updatedAt: now,
        })
        .where(eq(customerOrders.id, id));
    });

    return jsonData({ id, order_no: orderNo });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return jsonError(`Order number "${orderNo}" already exists.`, 409);
    }
    console.error("PUT /api/orders/[id] failed:", e);
    return jsonError("Failed to update order", 500);
  }
}

// DELETE /api/orders/:id — cascade removes lines + stage progress.
export async function DELETE(_req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN", "SALES"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const [existing] = await db
    .select({ id: customerOrders.id })
    .from(customerOrders)
    .where(eq(customerOrders.id, id))
    .limit(1);
  if (!existing) return jsonError("Order not found", 404);

  await db.delete(customerOrders).where(eq(customerOrders.id, id));
  return jsonData({ id });
}
