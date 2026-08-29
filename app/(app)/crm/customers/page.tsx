import { NotBuiltYet } from "@/components/crm/not-built-yet";

export default function CrmCustomersPage() {
  return (
    <NotBuiltYet
      title="Customers"
      phase="OE-P18"
      what="A read-only roll-up per customer: orders and value over 12 months, average rating with its trend, issue counts by category, last contacted, and reorder signals."
      blocked="This is a view over existing data, never a second customer master. It groups on crr_customer_id — which is null on a large share of orders, so some parties will appear under their raw name until the CRR linker resolves them."
    />
  );
}
