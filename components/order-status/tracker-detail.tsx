"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";

import { formatDate, formatNumber } from "@/lib/orders";
import type { OrderStatusRow, StageCell } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  isDispatched,
  toneOfLines,
  TONE_HEAD,
  TONE_LABEL,
  TONE_TEXT,
  type QualityGroup,
} from "./quality-groups";

// The seven stages as the operator names them, in the order the reference
// screen lists them. `order_entry` and `stock_checking` read differently from
// the rest: one is "order received", the other is the stock gate.
const DETAIL_STAGES: { key: string; label: string }[] = [
  { key: "order_entry", label: "Order status" },
  { key: "stock_checking", label: "Stock status" },
  { key: "rolling_checking", label: "Rolling checking" },
  { key: "challan", label: "Challan" },
  { key: "bill", label: "Billing" },
  { key: "dispatch", label: "Dispatch" },
  { key: "received_lr", label: "LR status" },
];

type Shown = { text: string; sub?: string; tone: "done" | "late" | "live" | "idle" };

function stageValue(key: string, cell: StageCell | undefined): Shown {
  if (!cell) return { text: "NA", tone: "idle" };

  if (key === "stock_checking") {
    if (cell.state === "done") return { text: "IN STOCK", tone: "done" };
    if (cell.stockStatus === "out_of_stock")
      return { text: "OUT OF STOCK", tone: "late" };
    return {
      text: cell.state === "overdue" ? "PENDING" : "PENDING",
      sub: cell.state === "overdue" ? `${cell.daysOverdue}d overdue` : undefined,
      tone: cell.state === "overdue" ? "late" : "live",
    };
  }

  if (cell.state === "done") {
    return {
      text: key === "order_entry" ? "ORDER RECEIVED" : "DONE",
      sub: cell.date ? formatDate(cell.date) : undefined,
      tone: "done",
    };
  }
  if (cell.state === "overdue")
    return { text: "PENDING", sub: `${cell.daysOverdue}d overdue`, tone: "late" };
  if (cell.state === "in_progress") return { text: "IN PROGRESS", tone: "live" };
  return { text: "NA", tone: "idle" };
}

const TONE: Record<Shown["tone"], string> = {
  done: "text-success",
  late: "text-danger",
  live: "text-accent",
  idle: "text-ink-muted",
};

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 py-2", className)}>
      <span className="shrink-0 text-[11px] font-medium tracking-[0.03em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="min-w-0 text-right text-sm font-medium text-ink">
        {children}
      </span>
    </div>
  );
}

// The right-hand panel: everything about the selected colour, plus its siblings
// under the same quality, so "which colours went out?" needs no second click.
export function TrackerDetail({
  line,
  group,
  index,
  total,
  onPrev,
  onNext,
  onSelectLine,
  onClose,
}: {
  line?: OrderStatusRow;
  group?: QualityGroup;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectLine: (lineId: string) => void;
  onClose?: () => void;
}) {
  if (!line) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-ink-soft">No design selected</p>
        <p className="max-w-[34ch] text-xs text-ink-muted">
          Pick any colour on the left — or a quality row — and its full status
          appears here. Use ← and → to step through them.
        </p>
      </div>
    );
  }

  const byKey = new Map(line.stages.map((s) => [s.stageKey, s]));
  const tone = toneOfLines([line]);

  return (
    <div className="flex h-full flex-col">
      {/* Header + navigation, tinted to match the row this was opened from. */}
      <div className={cn("flex items-center gap-2 border-b px-3 py-2.5", TONE_HEAD[tone])}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {line.party}
          </div>
          <div className="num truncate text-xs text-ink-soft">
            Order {line.orderNo} · {line.fabric}
          </div>
          <div className={cn("text-[11px] font-semibold", TONE_TEXT[tone])}>
            {TONE_LABEL[tone]}
          </div>
        </div>
        <span className="num shrink-0 text-[11px] text-ink-muted">
          {index + 1}/{total}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={onPrev}
          disabled={total < 2}
          aria-label="Previous design"
          title="Previous (←)"
          className="size-8 shrink-0"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNext}
          disabled={total < 2}
          aria-label="Next design"
          title="Next (→)"
          className="size-8 shrink-0"
        >
          <ChevronRightIcon />
        </Button>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close details"
            title="Close"
            className="size-8 shrink-0"
          >
            <XIcon />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {line.isCancelled ? (
          <p className="mb-2 rounded-field bg-danger/10 px-2.5 py-1.5 text-xs font-medium text-danger">
            This design is cancelled.
          </p>
        ) : null}

        <div className="divide-y divide-line">
          <Field label="OD date">{formatDate(line.odDate)}</Field>
          <Field label="Order no">
            <span className="num">{line.orderNo}</span>
          </Field>
          <Field label="Party">{line.party}</Field>
          <Field label="Sales person">{line.salesPerson || "—"}</Field>
          <Field label="Fabric / quality">{line.fabric}</Field>
          <Field label="Design matching">
            <span className="num">{line.design}</span>
          </Field>
          <Field label="Mtr / yard">
            <span className="num">{formatNumber(Number(line.qtyMtr))}</span>
          </Field>
          {line.haste ? <Field label="Haste">{line.haste}</Field> : null}
          {line.challanNo ? (
            <Field label="Challan no">
              <span className="num">{line.challanNo}</span>
            </Field>
          ) : null}
          {line.lotNo ? (
            <Field label="Lot no">
              <span className="num">{line.lotNo}</span>
            </Field>
          ) : null}
        </div>

        <div className="mt-3 rounded-field border border-line bg-surface-2 px-3 py-1">
          <div className="divide-y divide-line">
            {DETAIL_STAGES.map((s) => {
              const v = stageValue(s.key, byKey.get(s.key));
              return (
                <Field key={s.key} label={s.label}>
                  <span className={cn("font-semibold", TONE[v.tone])}>
                    {v.text}
                  </span>
                  {v.sub ? (
                    <span className="num ml-1.5 text-xs font-normal text-ink-soft">
                      {v.sub}
                    </span>
                  ) : null}
                </Field>
              );
            })}
          </div>
        </div>

        {/* Sibling colours under the same quality. */}
        {group && group.lines.length > 1 ? (
          <div className="mt-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium tracking-[0.03em] text-ink-muted uppercase">
                Colours in {group.fabric}
              </span>
              <span className="num text-[11px] text-ink-soft">
                {group.dispatched}/{group.lines.length} dispatched
              </span>
            </div>
            <div className="mb-1.5 text-[11px] text-ink-muted">
              ✓ dispatched · • not yet — click one to open it
            </div>
            <div className="flex flex-wrap gap-1">
              {group.lines.map((l) => (
                <ColourChip
                  key={l.lineId}
                  line={l}
                  active={l.lineId === line.lineId}
                  onClick={() => onSelectLine(l.lineId)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One colour (design/matching) with its dispatch state on its face — green
// means it has gone out, amber means it has not.
export function ColourChip({
  line,
  active,
  onClick,
}: {
  line: OrderStatusRow;
  active?: boolean;
  onClick?: () => void;
}) {
  const out = isDispatched(line);
  const cancelled = line.isCancelled;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={
        cancelled
          ? `${line.design} — cancelled`
          : out
            ? `${line.design} — dispatched`
            : `${line.design} — not dispatched`
      }
      className={cn(
        "num inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium transition-colors",
        cancelled
          ? "border-line bg-inset text-ink-muted line-through"
          : out
            ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
            : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20",
        active && "ring-2 ring-[var(--accent-ring)]",
      )}
    >
      <span aria-hidden>{cancelled ? "–" : out ? "✓" : "•"}</span>
      {line.design}
    </button>
  );
}
