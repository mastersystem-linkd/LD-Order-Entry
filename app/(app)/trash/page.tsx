import { auth } from "@/lib/auth";
import type { Capability } from "@/lib/rbac";
import { TrashView } from "@/components/trash/trash-view";

export default async function TrashPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  return <TrashView caps={caps} />;
}
