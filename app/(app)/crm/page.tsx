import { auth } from "@/lib/auth";
import { hasCap, type Capability } from "@/lib/rbac";
import { FollowupQueue } from "@/components/crm/followup-queue";

// CRM → Follow-ups (CLAUDE.md §12). Page-level access is enforced by
// canAccessPath in the edge middleware; this only decides whether the panel's
// controls are writable.
export default async function CrmFollowupsPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  const role = session?.user?.role;
  const canEdit = role === "ADMIN" || hasCap(caps, "crm.edit");
  return <FollowupQueue canEdit={canEdit} />;
}
