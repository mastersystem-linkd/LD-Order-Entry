import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { OrderDetailView } from "@/components/orders/order-detail";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user?.role as Role) ?? "VIEWER";
  return <OrderDetailView orderId={id} role={role} />;
}
