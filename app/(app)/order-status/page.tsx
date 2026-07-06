import { Suspense } from "react";

import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { OrderStatusBoard } from "@/components/order-status/order-status-board";

export default async function OrderStatusPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return (
    // Suspense boundary required because the board reads useSearchParams
    // (deep-link filters from the Dashboard KPIs).
    <Suspense fallback={null}>
      <OrderStatusBoard caps={caps} userKey={session?.user?.email ?? undefined} />
    </Suspense>
  );
}
