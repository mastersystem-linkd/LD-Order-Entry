import { timingSafeEqual } from "node:crypto";

import { asc, count, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { computeLineStatus } from "@/lib/workflow";
import {
  customerOrders,
  lineStageProgress,
  orderLineItems,
} from "@/db/schema";

// This route is intentionally OUTSIDE the user-session middleware (see the
// matcher in middleware.ts, which excludes `api/export`). It authenticates the
// Embroidery System with a static API key in the `x-api-key` header instead.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function jsonData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// Constant-time key comparison so a wrong key can't be timed character by char.
function validApiKey(provided: string | null): boolean {
  const expected = process.env.EXPORT_API_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// GET /api/export/orders — read-only incremental pull for the Embroidery System
// (CLAUDE.md §7). NO pricing is ever returned. Stable ids (order.id, line.id)
// become Embroidery's external_ref; stable ordering by (updated_at, id) keeps
// incremental sync reliable. `updated_since` is INCLUSIVE — the Embroidery side
// dedupes on the stable ids, so the boundary record may legitimately repeat.
export async function GET(req: Request) {
  if (!validApiKey(req.headers.get("x-api-key"))) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(req.url);

  const since = url.searchParams.get("updated_since");
  let updatedSince: Date | null = null;
  if (since) {
    updatedSince = new Date(since);
    if (Number.isNaN(updatedSince.getTime())) {
      return jsonError("updated_since must be an ISO timestamp", 400);
    }
  }

  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) ||
        DEFAULT_LIMIT,
    ),
  );

  const filter = updatedSince
    ? gte(customerOrders.updatedAt, updatedSince)
    : undefined;

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(customerOrders)
    .where(filter);

  const orders = await db
    .select({
      id: customerOrders.id,
      order_no: customerOrders.orderNo,
      order_date: customerOrders.orderDate,
      party_name: customerOrders.partyName,
      sales_person: customerOrders.salesPerson,
      department: customerOrders.department,
      updated_at: customerOrders.updatedAt,
    })
    .from(customerOrders)
    .where(filter)
    .orderBy(asc(customerOrders.updatedAt), asc(customerOrders.id))
    .limit(limit)
    .offset((page - 1) * limit);

  const orderIds = orders.map((o) => o.id);

  // Line items for this page (no rate / line_total — pricing never leaves here).
  const lines = orderIds.length
    ? await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          quality: orderLineItems.quality,
          design_no: orderLineItems.designNo,
          qty_mtr: orderLineItems.qtyMtr,
          is_cancelled: orderLineItems.isCancelled,
        })
        .from(orderLineItems)
        .where(inArray(orderLineItems.orderId, orderIds))
        .orderBy(asc(orderLineItems.createdAt))
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

  const out = orders.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    order_date: o.order_date,
    party_name: o.party_name,
    sales_person: o.sales_person,
    department: o.department,
    updated_at: o.updated_at,
    line_items: (linesByOrder.get(o.id) ?? []).map((l) => ({
      id: l.id,
      quality: l.quality,
      design_no: l.design_no,
      qty_mtr: l.qty_mtr,
      is_cancelled: l.is_cancelled,
      operations_status: computeLineStatus(stagesByLine.get(l.id) ?? []),
    })),
  }));

  return jsonData({
    orders: out,
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
}
