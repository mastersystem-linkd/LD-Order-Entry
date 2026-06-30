import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { OrderStatusBoard } from "@/components/order-status/order-status-board";

export default async function OrderStatusPage() {
  const session = await auth();
  const role = (session?.user?.role as Role) ?? "VIEWER";
  return <OrderStatusBoard role={role} />;
}
