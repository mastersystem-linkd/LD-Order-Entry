import "./db/load-env";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  designDatabase,
  lineStageProgress,
  lookupValues,
  orderLineItems,
} from "@/db/schema";

const base = "http://localhost:3000";
let fails = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log("PASS  " + name);
  else {
    console.log(`FAIL  ${name}  -- ${detail}`);
    fails++;
  }
}

const jar = new Map<string, string>();
function setCookies(res: Response) {
  const cookies: string[] = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function login(email: string, password: string) {
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  setCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: base + "/" });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: form.toString(),
    redirect: "manual",
  });
  setCookies(res);
}
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...(init.headers ?? {}) },
    redirect: "manual",
  });
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const isoUTC = (date: string, offsetDays: number) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString();
};

async function main() {
  await login("admin@ldorderentry.local", "ChangeMe123!");

  const orderNo = `P5-VERIFY-${Date.now()}`;
  const orderDate = "2026-03-10";
  const payload = {
    order: { order_no: orderNo, order_date: orderDate, party_name: "P5 Party", department: "LD" },
    fabrics: [{ fabric: "P5Cotton", rate: 50, designs: [{ design_no: "P5D1", qty_mtr: 10 }, { design_no: "P5D2", qty_mtr: 5 }] }],
  };
  let r = await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
  check("create order 201", r.status === 201, JSON.stringify(r.body));
  const orderId: string = r.body?.data?.id;

  // Design Database logging
  let dd = await db.select().from(designDatabase).where(eq(designDatabase.orderNo, orderNo));
  check("design_database has 2 rows after create", dd.length === 2, `got ${dd.length}`);

  // Re-save (PUT identical) → no duplicates
  r = await api(`/api/orders/${orderId}`, { method: "PUT", body: JSON.stringify(payload) });
  check("re-save (PUT) 200", r.status === 200, `${r.status}`);
  dd = await db.select().from(designDatabase).where(eq(designDatabase.orderNo, orderNo));
  check("design_database still 2 rows after re-save (deduped)", dd.length === 2, `got ${dd.length}`);

  // SLA planned dates: order_entry +1, dispatch +3, received_lr +4
  const lines = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const stageRows = await db.select().from(lineStageProgress).where(inArray(lineStageProgress.orderLineItemId, lines.map((l) => l.id)));
  const oneLine = lines[0].id;
  const byKey = (k: string) => stageRows.find((s) => s.orderLineItemId === oneLine && s.stageKey === k);
  check("order_entry planned = date+1", byKey("order_entry")?.plannedAt?.toISOString() === isoUTC(orderDate, 1), String(byKey("order_entry")?.plannedAt));
  check("dispatch planned = date+3", byKey("dispatch")?.plannedAt?.toISOString() === isoUTC(orderDate, 3), String(byKey("dispatch")?.plannedAt));
  check("received_lr planned = date+4", byKey("received_lr")?.plannedAt?.toISOString() === isoUTC(orderDate, 4), String(byKey("received_lr")?.plannedAt));

  // Designs autocomplete scoped by fabric
  r = await api(`/api/designs?fabric=${encodeURIComponent("P5Cotton")}`);
  const designs: string[] = r.body?.data ?? [];
  check("designs autocomplete returns P5D1/P5D2 for fabric", designs.includes("P5D1") && designs.includes("P5D2"), JSON.stringify(designs));

  // Lookups CRUD
  const partyVal = `ZZ P5 Party ${Date.now()}`;
  r = await api("/api/lookups", { method: "POST", body: JSON.stringify({ category: "PARTY", value: partyVal }) });
  check("lookup POST 201", r.status === 201, JSON.stringify(r.body));
  const lkId: string = r.body?.data?.id;
  r = await api("/api/lookups?category=PARTY&all=1");
  check("lookup appears in admin list", (r.body?.data ?? []).some((x: any) => x.id === lkId), "not found");
  r = await api(`/api/lookups/${lkId}`, { method: "PATCH", body: JSON.stringify({ value: partyVal + " EDITED" }) });
  check("lookup PATCH 200", r.status === 200, `${r.status}`);
  r = await api(`/api/lookups/${lkId}`, { method: "DELETE" });
  check("lookup DELETE (soft) 200", r.status === 200, `${r.status}`);
  r = await api("/api/lookups?category=PARTY");
  check("soft-deleted value excluded from active list", !(r.body?.data ?? []).includes(partyVal + " EDITED"), "still present");

  // Bulk import (idempotent)
  const bulkVals = ["ZZ Bulk A", "ZZ Bulk B", "ZZ Bulk A"]; // one dup
  r = await api("/api/lookups/bulk", { method: "POST", body: JSON.stringify({ category: "FABRIC", values: bulkVals }) });
  check("bulk import added 2 (deduped within paste)", r.body?.data?.added === 2, JSON.stringify(r.body?.data));
  r = await api("/api/lookups/bulk", { method: "POST", body: JSON.stringify({ category: "FABRIC", values: ["ZZ Bulk A", "ZZ Bulk B"] }) });
  check("bulk re-import idempotent (0 added, 2 skipped)", r.body?.data?.added === 0 && r.body?.data?.skipped === 2, JSON.stringify(r.body?.data));

  // Stages GET + PATCH + recompute
  r = await api("/api/stages");
  const stages = r.body?.data ?? [];
  check("stages GET returns 7", stages.length === 7, `got ${stages.length}`);
  check("dispatch offset is 3", stages.find((s: any) => s.stage_key === "dispatch")?.planned_offset_days === 3, "");
  r = await api("/api/stages/dispatch", { method: "PATCH", body: JSON.stringify({ planned_offset_days: 5 }) });
  check("stage PATCH 200", r.status === 200, `${r.status}`);
  r = await api("/api/stages/recompute", { method: "POST" });
  check("recompute returns a count", typeof r.body?.data?.recomputed === "number", JSON.stringify(r.body?.data));
  // our order's dispatch (not done) should now be date+5
  const afterRecompute = await db.select().from(lineStageProgress).where(and(eq(lineStageProgress.orderLineItemId, oneLine), eq(lineStageProgress.stageKey, "dispatch")));
  check("open order's dispatch recomputed to date+5", afterRecompute[0]?.plannedAt?.toISOString() === isoUTC(orderDate, 5), String(afterRecompute[0]?.plannedAt));
  // restore offset
  await api("/api/stages/dispatch", { method: "PATCH", body: JSON.stringify({ planned_offset_days: 3 }) });

  // Cleanup
  await api(`/api/orders/${orderId}`, { method: "DELETE" });
  await db.delete(lookupValues).where(like(lookupValues.value, "ZZ %"));

  console.log("=================");
  console.log("FAILURES: " + fails);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
