import { CustomersView } from "@/components/crm/customers-view";

// CRM → Customers (CLAUDE.md §12.5.4, OE-P18). Read-only: page access is
// enforced by canAccessPath in the edge middleware, and there is nothing here
// to write, so unlike the queue and the board this page takes no canEdit.
export default function CrmCustomersPage() {
  return <CustomersView />;
}
