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
// matcher in middleware.ts, which excludes `api/export`). Consumers authenticate
// with a static API key in the `x-api-key` header instead. Two consume it: the
// Embroidery System (stock/demand) and SCOT (the sales-coordinator dashboard).
// SCOT resolves our free-text party names to its own customer master via an
// alias table, so names MUST be passed through verbatim — never trimmed,
// case-folded or otherwise "cleaned", or they arrive as unknown new variants.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function jsonData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// Consumers of this feed, each with its own key so one can be rotated or
// revoked without disturbing the other.
//
// `pricing` is deliberately per-consumer. CLAUDE.md §7 kept pricing out of this
// export entirely; SCOT asked for it (revenue drives its client categorisation),
// the Embroidery System never did and does not need it. Gating on the key keeps
// the existing contract intact rather than widening it for everyone.
type Consumer = { name: string; pricing: boolean };

const CONSUMERS: { env: string; consumer: Consumer }[] = [
  { env: "EXPORT_API_KEY", consumer: { name: "embroidery", pricing: false } },
  { env: "EXPORT_API_KEY_SCOT", consumer: { name: "scot", pricing: true } },
];

// Constant-time key comparison so a wrong key can't be timed character by char.
// Every configured key is checked with no early exit, so response time reveals
// neither which key matched nor how many are configured.
function identifyConsumer(provided: string | null): Consumer | null {
  if (!provided) return null;
  const a = Buffer.from(provided);
  let matched: Consumer | null = null;
  for (const { env, consumer } of CONSUMERS) {
    const expected = process.env[env];
    if (!expected) continue;
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) matched = consumer;
  }
  return matched;
}

// GET /api/export/orders — read-only incremental pull (CLAUDE.md §7).
// Pricing is returned ONLY to consumers whose key grants it (SCOT), never to
// Embroidery. Stable ids (order.id, line.id) become each consumer's external_ref;
// stable ordering by (updated_at, id) keeps incremental sync reliable.
// `updated_since` is INCLUSIVE — consumers dedupe on the stable ids, so the
// boundary record may legitimately repeat.
export async function GET(req: Request) {
  const consumer = identifyConsumer(req.headers.get("x-api-key"));
  if (!consumer) {
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

  // Pricing is selected here but only emitted to consumers whose key grants it
  // (see CONSUMERS above).
  const lines = orderIds.length
    ? await db
        .select({
          id: orderLineItems.id,
          orderId: orderLineItems.orderId,
          quality: orderLineItems.quality,
          design_no: orderLineItems.designNo,
          qty_mtr: orderLineItems.qtyMtr,
          rate: orderLineItems.rate,
          line_total: orderLineItems.lineTotal,
          is_cancelled: orderLineItems.isCancelled,
          is_deleted: orderLineItems.isDeleted,
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
          stageKey: lineStageProgress.stageKey,
          isDone: lineStageProgress.isDone,
        })
        .from(lineStageProgress)
        .where(inArray(lineStageProgress.orderLineItemId, lineIds))
    : [];

  const stagesByLine = new Map<string, { stageKey: string; isDone: boolean }[]>();
  for (const s of stages) {
    const arr = stagesByLine.get(s.lineId) ?? [];
    arr.push({ stageKey: s.stageKey, isDone: s.isDone });
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
      // `line_total` is the generated qty_mtr * rate, i.e. SCOT's "amount".
      ...(consumer.pricing ? { rate: l.rate, line_total: l.line_total } : {}),
      is_cancelled: l.is_cancelled,
      // Soft-deleted lines are still emitted (flagged) so the Embroidery System
      // can remove them on its side — hiding them would leave a stale record.
      is_deleted: l.is_deleted,
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
