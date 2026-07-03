import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { OrdersDashboard } from "@/components/orders/orders-dashboard";

export default async function OrdersPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return <OrdersDashboard caps={caps} />;
}
