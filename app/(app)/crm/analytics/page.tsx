import { NotBuiltYet } from "@/components/crm/not-built-yet";

export default function CrmAnalyticsPage() {
  return (
    <NotBuiltYet
      title="CRM analytics"
      phase="OE-P18"
      what="Coverage (the honesty metric), the rating trend, a complaint Pareto by category, complaints by transport and fabric, resolution turnaround, and the system-vs-customer on-time gap."
      blocked="Every chart here needs completed follow-ups to plot. It stays empty until the queue has been worked, so building it before then would only show a convincing-looking zero."
    />
  );
}
