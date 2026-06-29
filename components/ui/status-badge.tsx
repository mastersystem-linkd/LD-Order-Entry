import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Operations status per line/order (CLAUDE.md §5). This app's status — not stock.
export type OperationsStatus =
  | "COMPLETED"
  | "PARTIALLY COMPLETED"
  | "PENDING";

const STATUS: Record<OperationsStatus, { label: string; className: string }> = {
  COMPLETED: {
    label: "Completed",
    className: "bg-success/15 text-success border-success/30",
  },
  "PARTIALLY COMPLETED": {
    label: "Partially completed",
    className: "bg-warning/15 text-warning border-warning/30",
  },
  PENDING: {
    label: "Pending",
    className: "bg-muted text-muted-foreground border-border",
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
    <Badge variant="outline" className={cn("border", cfg.className, className)}>
      {cfg.label}
    </Badge>
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
