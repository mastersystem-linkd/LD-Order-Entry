import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { TrackingBoard } from "@/components/tracking/tracking-board";

export default async function TrackingOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return <TrackingBoard orderId={id} caps={caps} />;
}
