import "./db/load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

const base = "http://localhost:3000";
const TEMP_EMAIL = normalizeEmail("zz-verify-dash@test.local");
const TEMP_PW = "VerifyDash123";

async function ensureTempAdmin() {
  const hash = await bcrypt.hash(TEMP_PW, 10);
  const [ex] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TEMP_EMAIL))
    .limit(1);
  if (ex)
    await db
      .update(users)
      .set({ passwordHash: hash, role: "ADMIN", isActive: true })
      .where(eq(users.id, ex.id));
  else
    await db.insert(users).values({
      email: TEMP_EMAIL,
      name: "Verify Dash",
      role: "ADMIN",
      passwordHash: hash,
      isActive: true,
    });
}
async function deleteTempAdmin() {
  await db.delete(users).where(eq(users.email, TEMP_EMAIL));
}
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
async function api(path: string) {
  const res = await fetch(`${base}${path}`, {
    headers: { cookie: cookieHeader() },
    redirect: "manual",
  });
  let body: any = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  check("dashboard requires auth (401)", (await fetch(`${base}/api/dashboard`)).status === 401);

  await ensureTempAdmin();
  await login(TEMP_EMAIL, TEMP_PW);
  const r = await api("/api/dashboard?from=2026-01-01&to=2026-12-31&department=ALL");
  check("dashboard 200", r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const d = r.body?.data;
  check("has kpis", d && typeof d.kpis?.orders === "number", JSON.stringify(d?.kpis));
  check("kpis.prev present", d?.kpis?.prev && typeof d.kpis.prev.value === "number", "");
  check("pipeline has 7 stages", Array.isArray(d?.pipeline) && d.pipeline.length === 7, `${d?.pipeline?.length}`);
  check("statusBreakdown present", d?.statusBreakdown && typeof d.statusBreakdown.completed === "number", "");
  check("delays present", d?.delays && typeof d.delays.onTime === "number", "");
  check("trend is array", Array.isArray(d?.trend), "");
  check("topParties array (<=6)", Array.isArray(d?.topParties) && d.topParties.length <= 6, `${d?.topParties?.length}`);
  check("topFabrics array (<=6)", Array.isArray(d?.topFabrics) && d.topFabrics.length <= 6, "");
  check("recentOrders array (<=8)", Array.isArray(d?.recentOrders) && d.recentOrders.length <= 8, "");
  check("attention array (<=10)", Array.isArray(d?.attention) && d.attention.length <= 10, "");

  // sanity: active + completed = orders-with-lines ; onTimePct 0..100
  check("onTimePct in 0..100", d?.kpis?.onTimePct >= 0 && d?.kpis?.onTimePct <= 100, `${d?.kpis?.onTimePct}`);
  check("active+completed <= orders", (d?.kpis?.activeOrders + d?.kpis?.completedOrders) <= d?.kpis?.orders + 0, `${d?.kpis?.activeOrders}+${d?.kpis?.completedOrders} vs ${d?.kpis?.orders}`);

  // department filter runs
  const r2 = await api("/api/dashboard?from=2026-01-01&to=2026-12-31&department=LD");
  check("department=LD 200", r2.status === 200, `${r2.status}`);

  await deleteTempAdmin();

  console.log("=================");
  console.log("FAILURES: " + fails);
  console.log("KPIs:", JSON.stringify(d?.kpis));
  console.log("Pipeline:", JSON.stringify(d?.pipeline?.map((p: any) => `${p.label}:${p.count}`)));
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
