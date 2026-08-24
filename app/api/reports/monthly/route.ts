import { jsonData, requireRole } from "@/lib/api";
import { ROLES } from "@/lib/rbac";
import { loadMonthlyReport } from "@/lib/monthly-report";

// GET /api/reports/monthly?department= — month-by-month history plus the dates
// the order book starts from. Feeds the month filter on every list screen and
// the Dashboard's monthly report.
export async function GET(req: Request) {
  const guard = await requireRole(ROLES);
  if (!guard.ok) return guard.response;

  const dept = new URL(req.url).searchParams.get("department");
  return jsonData(
    await loadMonthlyReport(dept === "LD" || dept === "LINKD" ? dept : "ALL"),
  );
}
