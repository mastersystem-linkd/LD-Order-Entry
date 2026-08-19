import { Suspense } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { dashboardParams, loadDashboard } from "@/lib/dashboard-query";

// The analytics are fetched HERE rather than by the browser. As a client-only
// query the request could not start until the route's JavaScript had downloaded
// and hydrated, so the page sat on skeletons for as long as that took; the
// aggregation itself is ~100 ms. The client still owns the query afterwards —
// changing the filters refetches through /api/dashboard as before.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? null;

  // The URL says `dept`; the API says `department`.
  const params = dashboardParams({
    from: one(sp.from),
    to: one(sp.to),
    department: one(sp.dept),
  });
  const data = await loadDashboard(params);

  // DashboardView reads the filters with useSearchParams, which Next requires
  // to sit under a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DashboardView initial={{ range: data.range, data }} />
    </Suspense>
  );
}
