import { jsonData, requireCapability } from "@/lib/api";
import { loadOrderStatus } from "@/lib/order-status-query";

// GET /api/order-status — the query itself lives in lib/order-status-query.ts.
export async function GET(req: Request) {
  const guard = await requireCapability("orders.view");
  if (!guard.ok) return guard.response;

  return jsonData(await loadOrderStatus(new URL(req.url).searchParams));
}
