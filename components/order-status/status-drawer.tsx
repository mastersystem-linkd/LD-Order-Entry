"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";

import { apiGet } from "@/lib/api-client";
import {
  formatDate,
  formatDateTime,
  formatDelay,
  formatNumber,
} from "@/lib/orders";
import type {
  OrderStatusDetail,
  OrderStatusDetailStage,
  StageState,
} from "@/lib/order-status";
import type { Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const iconBtn =
  "grid size-8 shrink-0 place-items-center rounded-[9px] border border-line bg-surface text-ink-soft transition-colors hover:bg-inset hover:text-ink disabled:pointer-events-none disabled:opacity-40";

const STATE_LABEL: Record<StageState, string> = {
  done: "Done",
  in_progress: "In progress",
  overdue: "Overdue",
  not_started: "Not started",
};
const STATE_PILL: Record<StageState, string> = {
  done: "bg-success/10 text-success",
  in_progress: "bg-warning/10 text-warning",
  overdue: "bg-danger/10 text-danger",
  not_started: "bg-inset text-ink-muted",
};

export function StatusDrawer({
  lineId,
  role,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  lineId: string;
  role: Role;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const asideRef = React.useRef<HTMLElement>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open; restore to the trigger on close.
  React.useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  // Esc closes, arrows navigate, Tab is trapped within the dialog.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowLeft" && hasPrev) return onPrev();
      if (e.key === "ArrowRight" && hasNext) return onNext();
      if (e.key === "Tab" && asideRef.current) {
        const f = Array.from(
          asideRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const q = useQuery({
    queryKey: ["order-status-detail", lineId],
    queryFn: () => apiGet<OrderStatusDetail>(`/api/order-status/${lineId}`),
  });
  const d = q.data;
  const canUpdate = role === "ADMIN" || role === "OPS";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0"
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label="Line status detail"
        className="relative z-10 flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150"
      >
        <div className="flex items-center gap-2 border-b border-line p-4">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            aria-label="Previous line"
            className={iconBtn}
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Next line"
            className={iconBtn}
          >
            <ChevronRightIcon className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            {d ? (
              <>
                <div className="truncate font-display text-[15px] font-semibold text-ink">
                  {d.order.party} · {d.line.fabric}
                </div>
                <div className="num truncate text-xs text-ink-soft">
                  {d.order.orderNo} · {d.line.design}
                </div>
              </>
            ) : (
              <div className="h-9" />
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={iconBtn}
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {q.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : q.isError || !d ? (
            <p className="py-10 text-sm text-danger">
              {(q.error as Error)?.message ?? "Failed to load detail."}
            </p>
          ) : (
            <>
              <div className="rounded-card border border-line bg-surface-2 p-4 sm:p-5">
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 sm:gap-x-5">
                  <Field label="OD date" value={formatDate(d.order.odDate)} mono />
                  <Field label="Order no" value={d.order.orderNo} mono />
                  <Field label="Agent" value={d.order.agent ?? "—"} />
                  <Field label="Haste" value={d.order.haste ?? "—"} />

                  <Field label="Fabric" value={d.line.fabric} />
                  <Field label="Design" value={d.line.design} />
                  <Field
                    label="Qty"
                    value={`${formatNumber(Number(d.line.qtyMtr))} mtr`}
                    mono
                  />
                  <Field label="Sales person" value={d.order.salesPerson ?? "—"} />

                  <Field label="Challan no" value={d.order.challanNo ?? "—"} />
                  <Field label="Lot no" value={d.order.lotNo ?? "—"} />
                  <Field label="Department" value={d.order.department ?? "—"} />
                  <Field label="Remarks" value={d.order.remarks ?? "—"} />
                </div>
                <div className="mt-4 border-t border-line pt-4 text-sm font-medium text-ink-soft">
                  <span className="num text-ink">{d.doneCount}</span> of 7 stages
                  complete
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-3 text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">
                  Stage timeline
                </div>
                <ol className="flex flex-col">
                  {d.stages.map((s, i) => (
                    <TimelineStep
                      key={s.stageKey}
                      step={s}
                      isLast={i === d.stages.length - 1}
                      current={s.stageKey === d.currentStageKey}
                    />
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-line p-4">
          {canUpdate && d ? (
            <Button className="w-full" render={<Link href={`/tracking/${d.order.id}`} />}>
              <ExternalLinkIcon /> Update in Operations
            </Button>
          ) : (
            <p className="text-center text-xs text-ink-muted">
              Status updates happen in Operations (Ops / Admin).
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function TimelineStep({
  step,
  isLast,
  current,
}: {
  step: OrderStatusDetailStage;
  isLast: boolean;
  current: boolean;
}) {
  const node =
    step.state === "done"
      ? "border-transparent bg-success text-white"
      : step.state === "overdue"
        ? "border-danger bg-danger/10 text-danger"
        : current
          ? "border-accent bg-accent/10 text-accent"
          : "border-line-strong bg-surface-2 text-ink-muted";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full border-2",
            node,
          )}
        >
          {step.state === "done" ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <span className="size-2 rounded-full bg-current" />
          )}
        </span>
        {!isLast ? <span className="my-1 w-0.5 flex-1 rounded-full bg-line" /> : null}
      </div>
      <div className={cn("min-w-0", isLast ? "pb-1" : "pb-5")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{step.label}</span>
          <span
            className={cn(
              "rounded-pill px-1.5 py-0.5 text-[10px] font-semibold",
              STATE_PILL[step.state],
            )}
          >
            {STATE_LABEL[step.state]}
            {step.state === "overdue" ? ` · ${step.daysOverdue}d` : ""}
          </span>
        </div>
        <div className="mt-1 text-xs text-ink-soft">
          Planned: <span className="num text-ink">{formatDate(step.plannedAt)}</span>
          {step.isDone ? (
            <>
              {" "}
              · Actual:{" "}
              <span className="num text-ink">
                {formatDateTime(step.actualAt)}
              </span>
            </>
          ) : null}
        </div>
        {step.isDone && step.delayMinutes != null ? (
          <span
            className={cn(
              "num mt-1 inline-flex rounded-pill px-1.5 py-0.5 text-[10px] font-medium",
              step.delayMinutes > 0
                ? "bg-warning/15 text-warning"
                : "bg-success/15 text-success",
            )}
          >
            {formatDelay(step.delayMinutes)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-ink-soft">{label}</div>
      <div className={cn("mt-0.5 text-sm font-medium text-ink", mono && "num")}>
        {value}
      </div>
    </div>
  );
}
