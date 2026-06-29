import "./db/load-env";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";

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

async function main() {
  // Unauthed → 401
  check("users API requires auth (401)", (await fetch(`${base}/api/users`)).status === 401);

  await login("admin@ldorderentry.local", "ChangeMe123!");
  let r = await api("/api/users");
  check("admin can list users", r.status === 200 && Array.isArray(r.body?.data?.users), JSON.stringify(r.body).slice(0, 120));
  const selfId = r.body?.data?.current_user_id;
  check("current_user_id present", !!selfId);

  const email = `zz-access-${Date.now()}@test.local`;
  r = await api("/api/users", { method: "POST", body: JSON.stringify({ email, name: "Test User", role: "SALES", password: "TempPass123" }) });
  check("create user 201", r.status === 201, JSON.stringify(r.body));
  const newId: string = r.body?.data?.id;
  check("new user role SALES", r.body?.data?.role === "SALES");

  // short password rejected
  r = await api("/api/users", { method: "POST", body: JSON.stringify({ email: `zz-x-${Date.now()}@t.local`, role: "VIEWER", password: "short" }) });
  check("short password rejected 422", r.status === 422, `${r.status}`);

  // duplicate email rejected
  r = await api("/api/users", { method: "POST", body: JSON.stringify({ email, role: "VIEWER", password: "TempPass123" }) });
  check("duplicate email rejected 409", r.status === 409, `${r.status}`);

  // change role
  r = await api(`/api/users/${newId}`, { method: "PATCH", body: JSON.stringify({ role: "OPS" }) });
  check("change role 200", r.status === 200, `${r.status}`);

  // new user can log in (separate jar)
  const jar2 = jar;
  // verify hash works by logging in as the new user in a fresh session
  const probe = new Map(jar);
  jar.clear();
  await login(email, "TempPass123");
  const me = await api("/api/orders");
  check("new user can authenticate", me.status === 200 || me.status === 403, `${me.status}`);
  // restore admin session
  jar.clear();
  for (const [k, v] of probe) jar.set(k, v);
  void jar2;

  // deactivate new user
  r = await api(`/api/users/${newId}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
  check("deactivate user 200", r.status === 200, `${r.status}`);

  // guardrail: admin can't deactivate self
  r = await api(`/api/users/${selfId}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
  check("self-deactivate blocked 409", r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);

  // guardrail: admin can't demote self
  r = await api(`/api/users/${selfId}`, { method: "PATCH", body: JSON.stringify({ role: "VIEWER" }) });
  check("self-demote blocked 409", r.status === 409, `${r.status}`);

  // guardrail: can't delete self
  r = await api(`/api/users/${selfId}`, { method: "DELETE" });
  check("self-delete blocked 409", r.status === 409, `${r.status}`);

  // reset password
  r = await api(`/api/users/${newId}`, { method: "PATCH", body: JSON.stringify({ password: "NewPass456" }) });
  check("reset password 200", r.status === 200, `${r.status}`);

  // delete test user
  r = await api(`/api/users/${newId}`, { method: "DELETE" });
  check("delete user 200", r.status === 200, `${r.status}`);

  // cleanup any stragglers
  await db.delete(users).where(like(users.email, "zz-access-%@test.local"));
  await db.delete(users).where(like(users.email, "zz-x-%@t.local"));
  void eq;

  console.log("=================");
  console.log("FAILURES: " + fails);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
