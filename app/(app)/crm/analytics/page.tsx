import { CrmAnalyticsView } from "@/components/crm/analytics-view";

// CRM → analytics (CLAUDE.md §12.5.5, OE-P18). Read-only: page access is
// enforced by canAccessPath in the edge middleware, and there is nothing here
// to write, so it takes no canEdit.
export default function CrmAnalyticsPage() {
  return <CrmAnalyticsView />;
}
