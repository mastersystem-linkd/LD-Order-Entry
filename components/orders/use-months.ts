"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api-client";
import type { MonthlyReport } from "@/lib/monthly-report";
import type { Department } from "@/lib/dashboard";

// Month-by-month history + the dates the order book starts from. Backs the
// month filter on every list screen and the Dashboard's monthly report, so one
// cached response serves both. It only changes when an order is added, so it is
// held for the session rather than refetched per screen.
export function useMonthlyReport(department: Department = "ALL") {
  return useQuery({
    queryKey: ["monthly-report", department],
    queryFn: () =>
      apiGet<MonthlyReport>(`/api/reports/monthly?department=${department}`),
    staleTime: 5 * 60_000,
  });
}
