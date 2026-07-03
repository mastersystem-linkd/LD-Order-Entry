import { cn } from "@/lib/utils";

// Operations status per line/order (CLAUDE.md §5). This app's status — not stock.
export type OperationsStatus =
  | "COMPLETED"
  | "PARTIALLY COMPLETED"
  | "PENDING"
  | "CANCELLED";

// Reference style (SOS / FlowMail): a soft tinted pill with a colored status dot.
const STATUS: Record<
  OperationsStatus,
  { label: string; pill: string; dot: string }
> = {
  COMPLETED: {
    label: "Completed",
    pill: "bg-success/10 text-success",
    dot: "bg-success",
  },
  "PARTIALLY COMPLETED": {
    label: "Partially completed",
    pill: "bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  PENDING: {
    label: "Pending",
    pill: "bg-inset text-ink-soft",
    dot: "bg-ink-muted",
  },
  CANCELLED: {
    label: "Cancelled",
    pill: "bg-danger/10 text-danger",
    dot: "bg-danger",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: OperationsStatus;
  className?: string;
}) {
  const cfg = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-medium whitespace-nowrap",
        cfg.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// CLAUDE.md §9 operations-stage colours, for the 7-stage tracking view (OE-P3).
export const STAGE_BADGE_CLASS: Record<string, string> = {
  order_entry: "bg-indigo-100 text-indigo-700 border-indigo-200",
  stock_checking: "bg-blue-100 text-blue-700 border-blue-200",
  rolling_checking: "bg-amber-100 text-amber-700 border-amber-200",
  challan: "bg-rose-100 text-rose-700 border-rose-200",
  bill: "bg-emerald-100 text-emerald-700 border-emerald-200",
  dispatch: "bg-violet-100 text-violet-700 border-violet-200",
  received_lr: "bg-cyan-100 text-cyan-700 border-cyan-200",
};
