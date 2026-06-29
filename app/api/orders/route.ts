import { count, desc, eq, ilike, inArray, or } from "drizzle-orm";

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
} from "@/lib/workflow";
import {
  customerOrders,
  designDatabase,
  lineStageProgress,
  orderLineItems,
  workflowStages,
} from "@/db/schema";

const PAGE_SIZE = 20;

// GET /api/orders?search=&page= — dashboard list with rolled-up qty/total/status.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );

  const filter = search
    ? or(
        ilike(customerOrders.orderNo, `%${search}%`),
        ilike(customerOrders.partyName, `%${search}%`),
        ilike(customerOrders.challanNo, `%${search}%`),
        ilike(customerOrders.lotNo, `%${search}%`),
      )
    : undefined;

  // count + page are independent — run them in one round trip.
  const [totalRes, orders] = await Promise.all([
    db.select({ value: count() }).from(customerOrders).where(filter),
    db
      .select()
      .from(customerOrders)
      .where(filter)
      .orderBy(desc(customerOrders.orderDate), desc(customerOrders.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRes[0].value;

  const orderIds = orders.map((o) => o.id);
  const lines = orderIds.length
    ? await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          quality: orderLineItems.quality,
          qtyMtr: orderLineItems.qtyMtr,
          lineTotal: orderLineItems.lineTotal,
          isCancelled: orderLineItems.isCancelled,
        })
        .from(orderLineItems)
        .where(inArray(orderLineItems.orderId, orderIds))
    : [];

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
  const linesByOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesByOrder.get(l.orderId) ?? [];
    arr.push(l);
    linesByOrder.set(l.orderId, arr);
  }

  const rows = orders.map((o) => {
    const active = (linesByOrder.get(o.id) ?? []).filter((l) => !l.isCancelled);
    const qtyTotal = active.reduce((s, l) => s + Number(l.qtyMtr), 0);
    const grandTotal = active.reduce((s, l) => s + Number(l.lineTotal ?? 0), 0);
    const fabrics = [...new Set(active.map((l) => l.quality))];
    const lineStatuses = active.map((l) =>
      computeLineStatus(stagesByLine.get(l.id) ?? []),
    );
    return {
      id: o.id,
      order_no: o.orderNo,
      order_date: o.orderDate,
      party_name: o.partyName,
      sales_person: o.salesPerson,
      challan_no: o.challanNo,
      lot_no: o.lotNo,
      department: o.department,
      fabrics,
      line_count: active.length,
      qty_total: Number(qtyTotal.toFixed(2)),
      grand_total: Number(grandTotal.toFixed(2)),
      operations_status: computeOrderStatus(lineStatuses),
      created_at: o.createdAt,
    };
  });

  return jsonData({
    orders: rows,
    page,
    page_size: PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

// POST /api/orders — create one header + fabric×design lines + 7 stage rows each,
// in a single transaction (CLAUDE.md §6). SALES/ADMIN only.
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN", "SALES"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = orderPayloadSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const { order, fabrics } = parsed.data;
  const orderNo = order.order_no.trim();

  const [dup] = await db
    .select({ id: customerOrders.id })
    .from(customerOrders)
    .where(eq(customerOrders.orderNo, orderNo))
    .limit(1);
  if (dup) return jsonError(`Order number "${orderNo}" already exists.`, 409);

  try {
    const result = await dbx.transaction(async (tx) => {
      const [created] = await tx
        .insert(customerOrders)
        .values({
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
          createdBy: guard.user.email ?? guard.user.name ?? null,
        })
        .returning({ id: customerOrders.id });

      const orderId = created.id;
      const lineValues = fabrics.flatMap((f) =>
        f.designs.map((d) => ({
          orderId,
          quality: f.fabric.trim(),
          designNo: d.design_no.trim(),
          qtyMtr: String(d.qty_mtr),
          rate: f.rate == null ? null : String(f.rate),
        })),
      );

      const insertedLines = await tx
        .insert(orderLineItems)
        .values(lineValues)
        .returning({ id: orderLineItems.id });

      // SLA planned dates from the Time Tracking config (workflow_stages).
      const offRows = await tx
        .select({
          stageKey: workflowStages.stageKey,
          off: workflowStages.plannedOffsetDays,
        })
        .from(workflowStages);
      const offsets = Object.fromEntries(offRows.map((r) => [r.stageKey, r.off]));

      const stageValues = insertedLines.flatMap((l) =>
        buildInitialStageRows(l.id, order.order_date, offsets),
      );
      await tx.insert(lineStageProgress).values(stageValues);

      // Design Database log — one row per unique (fabric, design) in this order.
      const seen = new Set<string>();
      const designRows = lineValues.flatMap((lv) => {
        const key = `${lv.quality}__${lv.designNo}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            orderId,
            orderNo,
            fabricName: lv.quality,
            designNo: lv.designNo,
          },
        ];
      });
      if (designRows.length) {
        await tx.insert(designDatabase).values(designRows).onConflictDoNothing();
      }

      return { orderId, lineCount: insertedLines.length };
    });

    return jsonData(
      { id: result.orderId, order_no: orderNo, line_count: result.lineCount },
      201,
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      return jsonError(`Order number "${orderNo}" already exists.`, 409);
    }
    console.error("POST /api/orders failed:", e);
    return jsonError("Failed to create order", 500);
  }
}
