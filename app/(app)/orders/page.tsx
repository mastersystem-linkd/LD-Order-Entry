import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { OrdersScreen } from "@/components/orders/orders-screen";

export default async function OrdersPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return <OrdersScreen caps={caps} />;
}
