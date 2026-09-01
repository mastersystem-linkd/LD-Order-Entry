import { CallsLog } from "@/components/crm/calls-log";

// CRM → Call log (CLAUDE.md §12.5.6). Read-only: page access is enforced by
// canAccessPath in the edge middleware, and there is nothing here to write.
export default function CrmCallsPage() {
  return <CallsLog />;
}
