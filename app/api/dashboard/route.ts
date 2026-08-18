import { jsonData, requireRole } from "@/lib/api";
import { ROLES } from "@/lib/rbac";
import { dashboardParams, loadDashboard } from "@/lib/dashboard-query";

// GET /api/dashboard?from=&to=&department= — server-aggregated analytics.
// The heavy lifting lives in lib/dashboard-query.ts so the Dashboard page can
// prefetch the identical payload during SSR.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const params = dashboardParams({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    department: url.searchParams.get("department"),
  });

  return jsonData(await loadDashboard(params));
}
