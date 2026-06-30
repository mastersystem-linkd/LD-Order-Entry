import { Suspense } from "react";

import { DashboardView } from "@/components/dashboard/dashboard-view";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <DashboardView />
    </Suspense>
  );
}
