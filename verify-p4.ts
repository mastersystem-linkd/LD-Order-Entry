import "./db/load-env";

const base = "http://localhost:3000";
const KEY = process.env.EXPORT_API_KEY ?? "";
let fails = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log("PASS  " + name);
  else {
    console.log(`FAIL  ${name}  -- ${detail}`);
    fails++;
  }
}

// --- session jar for the create/delete calls (these go through normal auth) ---
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
  const form = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: base + "/",
  });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
    },
    body: form.toString(),
    redirect: "manual",
  });
  setCookies(res);
}
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

// --- export call uses ONLY the x-api-key header (no session cookie) ---
async function exportGet(query: string, key: string | null) {
  const res = await fetch(`${base}/api/export/orders${query}`, {
    headers: key ? { "x-api-key": key } : {},
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body };
}

async function main() {
  check("EXPORT_API_KEY present in env", KEY.length > 0, "missing");

  // Auth matrix
  check("no key -> 401", (await exportGet("", null)).status === 401);
  check("wrong key -> 401", (await exportGet("", "nope")).status === 401);
  check("right key -> 200", (await exportGet("", KEY)).status === 200);

  // Create an order WITH pricing so we can prove pricing never leaks.
  await login("admin@ldorderentry.local", "ChangeMe123!");
  const orderNo = `P4-VERIFY-${Date.now()}`;
  const createdAtCursor = new Date(Date.now() - 5000).toISOString();
  const create = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      order: {
        order_no: orderNo,
        order_date: "2026-06-29",
        party_name: "Export Party",
        sales_person: "Amit Shah",
        department: "LD",
      },
      fabrics: [
        {
          fabric: "Cotton",
          rate: 123.45,
          designs: [
            { design_no: "D1", qty_mtr: 10 },
            { design_no: "D2", qty_mtr: 20 },
          ],
        },
      ],
    }),
  });
  check("create order 201", create.status === 201, JSON.stringify(create.body));
  const orderId: string = create.body?.data?.id;

  // Full pull and locate our order.
  let r = await exportGet("?limit=500", KEY);
  const ours = r.body?.data?.orders?.find((o: any) => o.id === orderId);
  check("export returns our order by stable id", !!ours, "not found in export");
  check(
    "order has external_ref fields",
    ours?.order_no === orderNo &&
      !!ours?.order_date &&
      ours?.party_name === "Export Party" &&
      ours?.sales_person === "Amit Shah" &&
      ours?.department === "LD" &&
      !!ours?.updated_at,
    JSON.stringify(ours),
  );
  check("order has 2 line items", ours?.line_items?.length === 2, `got ${ours?.line_items?.length}`);
  const line = ours?.line_items?.[0];
  check(
    "line has stable id + fields + operations_status",
    !!line?.id &&
      !!line?.quality &&
      !!line?.design_no &&
      line?.qty_mtr != null &&
      typeof line?.is_cancelled === "boolean" &&
      line?.operations_status === "PENDING",
    JSON.stringify(line),
  );

  // NO PRICING anywhere in the payload.
  const ourJson = JSON.stringify(ours);
  check("no 'rate' field leaks", !ourJson.includes('"rate"'), ourJson);
  check("no 'line_total' field leaks", !ourJson.includes("line_total"), ourJson);
  check("no '123.45' value leaks", !ourJson.includes("123.45"), ourJson);

  // updated_since: a future cursor excludes it; a past cursor includes it.
  const future = new Date(Date.now() + 60_000).toISOString();
  r = await exportGet(`?updated_since=${encodeURIComponent(future)}`, KEY);
  check(
    "updated_since future excludes our order",
    !r.body?.data?.orders?.some((o: any) => o.id === orderId),
    "still present with future cursor",
  );
  r = await exportGet(
    `?updated_since=${encodeURIComponent(createdAtCursor)}&limit=500`,
    KEY,
  );
  check(
    "updated_since past includes our order",
    r.body?.data?.orders?.some((o: any) => o.id === orderId),
    "missing with past cursor",
  );

  // Bad cursor -> 400
  check(
    "bad updated_since -> 400",
    (await exportGet("?updated_since=not-a-date", KEY)).status === 400,
  );

  // Pagination: limit honored.
  r = await exportGet("?limit=1&page=1", KEY);
  check(
    "limit=1 returns at most 1 order",
    Array.isArray(r.body?.data?.orders) && r.body.data.orders.length <= 1,
    `len ${r.body?.data?.orders?.length}`,
  );
  check(
    "pagination meta present",
    r.body?.data?.limit === 1 &&
      typeof r.body?.data?.total === "number" &&
      typeof r.body?.data?.total_pages === "number",
    JSON.stringify(r.body?.data),
  );

  // Cleanup
  const del = await api(`/api/orders/${orderId}`, { method: "DELETE" });
  check("cleanup delete 200", del.status === 200, `${del.status}`);

  console.log("=================");
  console.log("FAILURES: " + fails);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
