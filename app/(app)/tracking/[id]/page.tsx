import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { TrackingBoard } from "@/components/tracking/tracking-board";

export default async function TrackingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user?.role as Role) ?? "VIEWER";
  return <TrackingBoard orderId={id} role={role} />;
}
