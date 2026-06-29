import "./db/load-env";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { lineStageProgress, orderLineItems } from "@/db/schema";

const base = "http://localhost:3000";
let fails = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log("PASS  " + name);
  else { console.log(`FAIL  ${name}  -- ${detail}`); fails++; }
}

const jar = new Map<string, string>();
function setCookies(res: Response) {
  // @ts-expect-error getSetCookie exists in Node 18+
  const cookies: string[] = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

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

async function main() {
  await login("admin@ldorderentry.local", "ChangeMe123!");
  const sess = [...jar.keys()].some((k) => k.includes("session-token"));
  check("admin login (session cookie)", sess, "no session cookie");

  const orderNo = `P2-VERIFY-${Date.now()}`;

  let r = await api(`/api/orders/check-no?orderNo=${encodeURIComponent(orderNo)}`);
  check("check-no available=true (fresh)", r.status === 200 && r.body?.data?.available === true, JSON.stringify(r.body));

  const createPayload = {
    order: { order_no: orderNo, order_date: "2026-06-29", party_name: "Verify Party", sales_person: "Amit Shah", department: "LD" },
    fabrics: [
      { fabric: "Cotton", rate: 100, designs: [{ design_no: "D1", qty_mtr: 10 }, { design_no: "D2", qty_mtr: 20 }] },
      { fabric: "Silk", rate: 200, designs: [{ design_no: "S1", qty_mtr: 5 }, { design_no: "S2", qty_mtr: 8 }] },
    ],
  };
  r = await api("/api/orders", { method: "POST", body: JSON.stringify(createPayload) });
  check("create multi-fabric order 201", r.status === 201 && r.body?.data?.line_count === 4, `${r.status} ${JSON.stringify(r.body)}`);
  const orderId: string = r.body?.data?.id;

  r = await api(`/api/orders/check-no?orderNo=${encodeURIComponent(orderNo)}`);
  check("check-no available=false (after create)", r.body?.data?.available === false, JSON.stringify(r.body));

  r = await api("/api/orders", { method: "POST", body: JSON.stringify(createPayload) });
  check("duplicate order_no rejected 409", r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);

  r = await api(`/api/orders?search=${encodeURIComponent(orderNo)}`);
  const row = r.body?.data?.orders?.find((o: any) => o.order_no === orderNo);
  check("list finds order", !!row, JSON.stringify(r.body?.data?.orders?.slice(0, 1)));
  check("list qty_total=43", row?.qty_total === 43, `got ${row?.qty_total}`);
  check("list grand_total=5600", row?.grand_total === 5600, `got ${row?.grand_total}`);
  check("list operations_status=PENDING", row?.operations_status === "PENDING", `got ${row?.operations_status}`);
  check("list fabrics=[Cotton,Silk]", JSON.stringify((row?.fabrics ?? []).sort()) === JSON.stringify(["Cotton", "Silk"]), JSON.stringify(row?.fabrics));

  r = await api(`/api/orders/${orderId}`);
  check("get single: 2 fabric blocks", r.body?.data?.fabrics?.length === 2, JSON.stringify(r.body?.data?.fabrics));
  check("get single: 4 lines", r.body?.data?.lines?.length === 4, `got ${r.body?.data?.lines?.length}`);

  // DB: 4 lines x 7 stage rows = 28; order_entry planned, rest null
  const lines = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const lineIds = lines.map((l) => l.id);
  const stageRows = await db.select().from(lineStageProgress).where(inArray(lineStageProgress.orderLineItemId, lineIds));
  check("28 stage rows (4 lines x 7)", stageRows.length === 28, `got ${stageRows.length}`);
  const oe = stageRows.filter((s) => s.stageKey === "order_entry");
  check("order_entry planned_at set on all lines", oe.length === 4 && oe.every((s) => s.plannedAt != null), JSON.stringify(oe.map((s) => s.plannedAt)));
  check("non-entry stages have null planned_at", stageRows.filter((s) => s.stageKey !== "order_entry").every((s) => s.plannedAt == null), "some non-entry planned_at set");

  // Mark stock_checking done on the Cotton/D1/10 line (to be preserved on edit)
  const keep = lines.find((l) => l.quality === "Cotton" && l.designNo === "D1" && Number(l.qtyMtr) === 10)!;
  await db.update(lineStageProgress).set({ isDone: true, actualAt: new Date() }).where(and(eq(lineStageProgress.orderLineItemId, keep.id), eq(lineStageProgress.stageKey, "stock_checking")));
  const keepStageBefore = await db.select().from(lineStageProgress).where(and(eq(lineStageProgress.orderLineItemId, keep.id), eq(lineStageProgress.stageKey, "stock_checking")));
  const keepStageId = keepStageBefore[0].id;

  // Edit: keep Cotton/D1/10 + Silk/S1/5; change Cotton/D2 -> qty 25 (new); add Silk/S3/12 (new); drop Silk/S2
  const editPayload = {
    order: { order_no: orderNo, order_date: "2026-06-29", party_name: "Verify Party EDITED", sales_person: "Amit Shah", department: "LD" },
    fabrics: [
      { fabric: "Cotton", rate: 100, designs: [{ design_no: "D1", qty_mtr: 10 }, { design_no: "D2", qty_mtr: 25 }] },
      { fabric: "Silk", rate: 200, designs: [{ design_no: "S1", qty_mtr: 5 }, { design_no: "S3", qty_mtr: 12 }] },
    ],
  };
  r = await api(`/api/orders/${orderId}`, { method: "PUT", body: JSON.stringify(editPayload) });
  check("edit (PUT) 200", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);

  const linesAfter = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  check("after edit: 4 lines", linesAfter.length === 4, `got ${linesAfter.length}`);
  const keptStill = linesAfter.find((l) => l.id === keep.id);
  check("preserved line kept (same id)", !!keptStill, "Cotton/D1/10 line id changed/removed");
  const keepStageAfter = await db.select().from(lineStageProgress).where(eq(lineStageProgress.id, keepStageId));
  check("preserved line's ticked stage SURVIVES edit", keepStageAfter.length === 1 && keepStageAfter[0].isDone === true, JSON.stringify(keepStageAfter));

  const newLine = linesAfter.find((l) => l.quality === "Cotton" && l.designNo === "D2" && Number(l.qtyMtr) === 25);
  check("changed-qty line is a NEW row", !!newLine && !lineIds.includes(newLine.id), "expected new id for Cotton/D2/25");
  if (newLine) {
    const newStages = await db.select().from(lineStageProgress).where(eq(lineStageProgress.orderLineItemId, newLine.id));
    check("new line has 7 fresh stage rows (all undone)", newStages.length === 7 && newStages.every((s) => !s.isDone), `${newStages.length} rows`);
  }
  const totalStagesAfter = await db.select().from(lineStageProgress).where(inArray(lineStageProgress.orderLineItemId, linesAfter.map((l) => l.id)));
  check("after edit: 28 stage rows total", totalStagesAfter.length === 28, `got ${totalStagesAfter.length}`);

  // Delete
  r = await api(`/api/orders/${orderId}`, { method: "DELETE" });
  check("delete order 200", r.status === 200, `${r.status}`);
  r = await api(`/api/orders/${orderId}`);
  check("get deleted order 404", r.status === 404, `${r.status}`);
  const orphanLines = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  check("cascade removed lines", orphanLines.length === 0, `${orphanLines.length} lines left`);

  console.log("=================");
  console.log("FAILURES: " + fails);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
