import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  isUniqueViolation,
  jsonData,
  jsonError,
  requireAnyCapability,
  requireCapability,
} from "@/lib/api";
import { db, dbx } from "@/lib/db";
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
const EXPORT_MAX = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/orders?search=&page=&order_no=&challan_no=&lot_no=&haste=&from=&to=&all=
// Dashboard list with rolled-up qty/total/status. `all=1` returns the whole
// filtered set (no pagination) for CSV export.
export async function GET(req: Request) {
  const guard = await requireAnyCapability(["orders.view", "operations.view"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = url.searchParams;
  const search = q.get("search")?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(q.get("page") ?? "1", 10) || 1);
  const exportAll = q.get("all") === "1";
  // Operations view opts into this: hide orders that don't yet have both a
  // challan no and a lot no (they aren't ready to be tracked).
  const requireChallanLot = q.get("require_challan_lot") === "1";

  // Column filters (case-insensitive contains for text; inclusive date range).
  const orderNo = q.get("order_no")?.trim() ?? "";
  const challanNo = q.get("challan_no")?.trim() ?? "";
  const lotNo = q.get("lot_no")?.trim() ?? "";
  const haste = q.get("haste")?.trim() ?? "";
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";

  const searchFilter = search
    ? or(
        ilike(customerOrders.orderNo, `%${search}%`),
        ilike(customerOrders.partyName, `%${search}%`),
        ilike(customerOrders.challanNo, `%${search}%`),
        ilike(customerOrders.lotNo, `%${search}%`),
      )
    : undefined;
  const challanLotFilter = requireChallanLot
    ? sql`btrim(coalesce(${customerOrders.challanNo}, '')) <> '' and btrim(coalesce(${customerOrders.lotNo}, '')) <> ''`
    : undefined;
  // and() drops undefined operands and returns undefined if none remain.
  const filter = and(
    searchFilter,
    challanLotFilter,
    orderNo ? ilike(customerOrders.orderNo, `%${orderNo}%`) : undefined,
    challanNo ? ilike(customerOrders.challanNo, `%${challanNo}%`) : undefined,
    lotNo ? ilike(customerOrders.lotNo, `%${lotNo}%`) : undefined,
    haste ? ilike(customerOrders.haste, `%${haste}%`) : undefined,
    ISO_DATE.test(from) ? gte(customerOrders.orderDate, from) : undefined,
    ISO_DATE.test(to) ? lte(customerOrders.orderDate, to) : undefined,
  );

  const listQuery = db
    .select()
    .from(customerOrders)
    .where(filter)
    .orderBy(desc(customerOrders.orderDate), desc(customerOrders.createdAt));

  // count + page are independent — run them in one round trip.
  const [totalRes, orders] = await Promise.all([
    db.select({ value: count() }).from(customerOrders).where(filter),
    exportAll
      ? listQuery.limit(EXPORT_MAX)
      : listQuery.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
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
      agent: o.agent,
      haste: o.haste,
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
  const guard = await requireCapability("orders.edit");
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
