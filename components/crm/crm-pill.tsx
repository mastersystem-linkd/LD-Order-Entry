import * as React from "react";

import { STATUS_LABEL, type FollowupStatus, type PriorityBand } from "@/lib/crm";
import { cn } from "@/lib/utils";

// CRM status pills. A sibling of components/ui/status-badge.tsx rather than an
// extension of it: that component's union is the ORDER lifecycle (COMPLETED /
// PARTIALLY COMPLETED / PENDING / CANCELLED) and widening it to carry a second,
// unrelated vocabulary would make one component answer two questions.
//
// The tints are the app's `/10` alpha idiom, not the mockup's opaque `-soft`
// variables — the app has exactly one `-soft` colour token and adding three more
// would leave two competing ways to express the same thing.

const TONE = {
  due: "bg-inset text-ink-soft",
  progress: "bg-accent/10 text-accent-deep",
  done: "bg-success/10 text-success",
  late: "bg-danger/10 text-danger",
  warn: "bg-warning/10 text-warning",
} as const;

type Tone = keyof typeof TONE;

export function Pill({
  tone,
  dot = true,
  children,
  className,
}: {
  tone: Tone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<FollowupStatus, Tone> = {
  DUE: "due",
  IN_PROGRESS: "progress",
  COMPLETED: "done",
  UNREACHABLE: "warn",
  NOT_REQUIRED: "due",
};

export function StatusPill({
  status,
  overdue,
}: {
  status: FollowupStatus;
  overdue?: boolean;
}) {
  // "Call overdue", not "Overdue": every row in this queue is a DELIVERED order,
  // so a bare "Overdue" reads as if the ORDER is late — which is the adjacent
  // "Our SLA" column, a different clock entirely. What is overdue here is the
  // phone call, measured from delivery + crm_settings.followup_due_days.
  if (overdue && (status === "DUE" || status === "IN_PROGRESS")) {
    return <Pill tone="late">Call overdue</Pill>;
  }
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

// The priority bar. The mockup encodes priority in colour ALONE; CLAUDE.md §9
// requires close hues to carry a label, so the bar keeps a title and an
// aria-label and the band is also readable as text on the row.
const BAND: Record<PriorityBand, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-line-strong",
};

export function PriorityBar({
  band,
  label,
}: {
  band: PriorityBand;
  label: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={cn("block h-[26px] w-1 shrink-0 rounded-sm", BAND[band])}
    />
  );
}
