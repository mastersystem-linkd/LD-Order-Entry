import "./db/load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

const base = "http://localhost:3000";
const TEMP_EMAIL = normalizeEmail("zz-verify-os@test.local");
const TEMP_PW = "VerifyOs123";
let fails = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log("PASS  " + name);
  else {
    console.log(`FAIL  ${name}  -- ${detail}`);
    fails++;
  }
}

async function ensureAdmin() {
  const hash = await bcrypt.hash(TEMP_PW, 10);
  const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEMP_EMAIL)).limit(1);
  if (ex) await db.update(users).set({ passwordHash: hash, role: "ADMIN", isActive: true }).where(eq(users.id, ex.id));
  else await db.insert(users).values({ email: TEMP_EMAIL, name: "Verify OS", role: "ADMIN", passwordHash: hash, isActive: true });
}
const delAdmin = () => db.delete(users).where(eq(users.email, TEMP_EMAIL));

const jar = new Map<string, string>();
function setCookies(res: Response) {
  const cookies: string[] = res.headers.getSetCookie?.() ?? [];
  for (const c of cookies) { const pair = c.split(";")[0]; const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
async function login() {
  const csrfRes = await fetch(`${base}/api/auth/csrf`); setCookies(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const form = new URLSearchParams({ csrfToken, email: TEMP_EMAIL, password: TEMP_PW, callbackUrl: base + "/" });
  const res = await fetch(`${base}/api/auth/callback/credentials`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() }, body: form.toString(), redirect: "manual" });
  setCookies(res);
}
async function api(path: string) {
  const res = await fetch(`${base}${path}`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  let body: any = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  check("order-status requires auth (401)", (await fetch(`${base}/api/order-status`)).status === 401);
  await ensureAdmin();
  await login();

  let r = await api("/api/order-status");
  check("list 200", r.status === 200, `${r.status}`);
  const d = r.body?.data;
  check("rows is array", Array.isArray(d?.rows), "");
  check("summary present", d?.summary && typeof d.summary.total === "number", JSON.stringify(d?.summary));
  check("pagination meta", typeof d?.total === "number" && typeof d?.totalPages === "number", "");
  const row = d?.rows?.[0];
  check("row has 7 stages", row && Array.isArray(row.stages) && row.stages.length === 7, `${row?.stages?.length}`);
  check("row overall valid", ["completed", "in_progress", "overdue"].includes(row?.overall), `${row?.overall}`);
  check("row doneCount 0..7", row?.doneCount >= 0 && row?.doneCount <= 7, `${row?.doneCount}`);
  const states = new Set(row?.stages?.map((s: any) => s.state));
  check("stage states valid", [...states].every((s) => ["done", "in_progress", "overdue", "not_started"].includes(s as string)), JSON.stringify([...states]));

  // overall filter reduces/agrees with summary
  r = await api("/api/order-status?overall=overdue");
  const allOverdue = (r.body?.data?.rows ?? []).every((x: any) => x.overall === "overdue");
  check("overall=overdue rows all overdue", allOverdue, "");
  check("overdue count matches summary", r.body?.data?.total === d?.summary?.overdue, `${r.body?.data?.total} vs ${d?.summary?.overdue}`);

  // search returns subset (status 200)
  r = await api(`/api/order-status?search=${encodeURIComponent(row?.orderNo ?? "x")}`);
  check("search 200 + finds the order", r.status === 200 && (r.body?.data?.rows ?? []).some((x: any) => x.orderNo === row?.orderNo), "");

  // export all
  r = await api("/api/order-status?all=1");
  check("all=1 returns >= page rows", (r.body?.data?.rows?.length ?? 0) >= (d?.rows?.length ?? 0), "");

  // detail
  if (row?.lineId) {
    r = await api(`/api/order-status/${row.lineId}`);
    const det = r.body?.data;
    check("detail 200", r.status === 200, `${r.status}`);
    check("detail has 7 stages w/ planned/actual", det?.stages?.length === 7 && "plannedAt" in (det?.stages?.[0] ?? {}), "");
    check("detail order fields", !!det?.order?.orderNo && !!det?.line?.fabric, "");
  }
  check("detail 404 for bad id", (await api("/api/order-status/00000000-0000-0000-0000-000000000000")).status === 404);

  await delAdmin();
  console.log("=================");
  console.log("FAILURES: " + fails);
  console.log("SUMMARY:", JSON.stringify(d?.summary), "| first row:", row?.orderNo, row?.overall, `${row?.doneCount}/7`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
