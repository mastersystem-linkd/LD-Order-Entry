import { auth } from "@/lib/auth";
import { hasCap, type Capability } from "@/lib/rbac";
import { IssuesBoard } from "@/components/crm/issues-board";

// CRM → Issues (CLAUDE.md §12.5, OE-P17). Page access is enforced by
// canAccessPath in the edge middleware; this only gates whether the resolve
// controls are writable.
export default async function CrmIssuesPage() {
  const session = await auth();
  const caps = (session?.user?.caps as Capability[] | undefined) ?? [];
  const role = session?.user?.role;
  const canEdit = role === "ADMIN" || hasCap(caps, "crm.edit");
  return <IssuesBoard canEdit={canEdit} />;
}
