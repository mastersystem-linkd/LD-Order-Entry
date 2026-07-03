import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { OrderDetailView } from "@/components/orders/order-detail";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return <OrderDetailView orderId={id} caps={caps} />;
}
