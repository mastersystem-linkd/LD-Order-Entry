import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { OrdersDashboard } from "@/components/orders/orders-dashboard";

export default async function OrdersPage() {
  const session = await auth();
  const role = (session?.user?.role as Role) ?? "VIEWER";
  return <OrdersDashboard role={role} />;
}
