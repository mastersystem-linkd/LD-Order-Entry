"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrosshairIcon,
  GripHorizontalIcon,
  XIcon,
} from "lucide-react";

import { formatDate, formatNumber } from "@/lib/orders";
import type { OrderStatusRow, StageCell } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import {
  isDispatched,
  toneOfLines,
  TONE_LABEL,
  type QualityGroup,
} from "./quality-groups";
import { STAGE_COLUMNS } from "./stage-cell";

type StageShown = {
  text: string;
  sub?: string;
  tone: "done" | "late" | "live" | "idle";
};

// What each stage should read as. `order_entry` and `stock_checking` are the
// two that do not simply say "done": one is "order received", the other is the
// stock gate, which can also come back "out of stock".
function stageValue(key: string, cell: StageCell | undefined): StageShown {
  if (!cell) return { text: "Not started", tone: "idle" };

  if (key === "stock_checking") {
    if (cell.state === "done") return { text: "In stock", tone: "done" };
    if (cell.stockStatus === "out_of_stock")
      return { text: "Out of stock", tone: "late" };
    return {
      text: "Pending",
      sub: cell.state === "overdue" ? `${cell.daysOverdue}d overdue` : undefined,
      tone: cell.state === "overdue" ? "late" : "live",
    };
  }
  if (cell.state === "done")
    return {
      text: key === "order_entry" ? "Order received" : "Done",
      sub: cell.date ? formatDate(cell.date) : undefined,
      tone: "done",
    };
  if (cell.state === "overdue")
    return { text: "Pending", sub: `${cell.daysOverdue}d overdue`, tone: "late" };
  if (cell.state === "in_progress") return { text: "In progress", tone: "live" };
  return { text: "Not started", tone: "idle" };
}

const DOT: Record<StageShown["tone"], string> = {
  done: "border-success bg-success text-white",
  late: "border-danger bg-danger/10 text-danger",
  live: "border-accent bg-accent/10 text-accent",
  idle: "border-line-strong bg-surface text-ink-muted",
};
const VALUE: Record<StageShown["tone"], string> = {
  done: "text-success",
  late: "text-danger",
  live: "text-accent",
  idle: "text-ink-muted",
};
const PILL: Record<string, string> = {
  done: "bg-success/15 text-success ring-success/30",
  progress: "bg-warning/15 text-warning ring-warning/30",
  none: "bg-danger/15 text-danger ring-danger/30",
  cancelled: "bg-inset text-ink-muted ring-line",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] text-ink-muted uppercase">
        {label}
      </span>
      <span className="min-w-0 text-right text-[13px] font-semibold text-ink">
        {children}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold tracking-[0.09em] text-ink-muted uppercase">
      {children}
    </div>
  );
}

export function TrackerDetail({
  line,
  group,
  index,
  total,
  onPrev,
  onNext,
  onSelectLine,
  onClose,
  onDragStart,
  onGoToRow,
}: {
  line?: OrderStatusRow;
  group?: QualityGroup;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectLine: (lineId: string) => void;
  onClose?: () => void;
  /** Pointer-down on the title bar starts dragging the panel. */
  onDragStart?: (e: React.PointerEvent) => void;
  /** Scroll the table to the row this panel is showing, and flash it. */
  onGoToRow?: () => void;
}) {
  if (!line) return null;

  const byKey = new Map(line.stages.map((s) => [s.stageKey, s]));
  const tone = toneOfLines([line]);
  const doneCount = line.stages.filter((s) => s.state === "done").length;
  const totalStages = line.stages.length || 7;
  const pct = Math.round((doneCount / totalStages) * 100);

  // Buttons sit inside the drag handle; stop them starting a drag.
  const stopDrag = (e: React.PointerEvent) => e.stopPropagation();
  const navBtn =
    "inline-flex size-7 items-center justify-center rounded-field border border-line-strong bg-surface text-ink-soft transition-colors hover:bg-inset hover:text-ink disabled:opacity-40";

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header: who / what, navigation, and how far along. It is also the
          drag handle — the panel covers part of the table, so it has to be
          movable. Double-click snaps it back to its default corner. */}
      <div
        onPointerDown={onDragStart}
        className={cn(
          "border-b border-line px-4 pt-3.5 pb-3",
          onDragStart && "cursor-grab active:cursor-grabbing select-none",
        )}
      >
        <div className="flex items-start gap-2">
          {onDragStart ? (
            <GripHorizontalIcon
              aria-hidden
              className="mt-1 size-4 shrink-0 text-ink-muted"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] leading-tight font-semibold text-ink">
              {line.party}
            </h2>
            <p className="num mt-0.5 truncate text-xs text-ink-soft">
              Order {line.orderNo} · {line.fabric} · {line.design}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={total < 2}
              onPointerDown={stopDrag}
              className={navBtn}
              aria-label="Previous design"
              title="Previous (←)"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span className="num w-14 text-center text-[11px] text-ink-muted">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={total < 2}
              onPointerDown={stopDrag}
              className={navBtn}
              aria-label="Next design"
              title="Next (→)"
            >
              <ChevronRightIcon className="size-4" />
            </button>
            {onGoToRow ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onGoToRow}
                className={cn(navBtn, "ml-1")}
                aria-label="Go to this row in the table"
                title="Go to this row in the table"
              >
                <CrosshairIcon className="size-4" />
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                onPointerDown={stopDrag}
                className={cn(navBtn, "ml-1")}
                aria-label="Close details"
                title="Close (Esc)"
              >
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
              PILL[tone],
            )}
          >
            {TONE_LABEL[tone]}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-inset">
              <div
                className={cn(
                  "h-full rounded-pill transition-all",
                  tone === "done"
                    ? "bg-success"
                    : tone === "none"
                      ? "bg-danger/50"
                      : "bg-warning",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="num shrink-0 text-[11px] font-medium text-ink-soft">
              {doneCount}/{totalStages}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {line.isCancelled ? (
          <p className="mb-3 rounded-field bg-danger/10 px-3 py-2 text-xs font-medium text-danger ring-1 ring-danger/20 ring-inset">
            This design is cancelled.
          </p>
        ) : null}

        <div className="rounded-card border border-line bg-surface-2 px-3 py-1">
          <div className="divide-y divide-line">
            <Row label="OD date">{formatDate(line.odDate)}</Row>
            <Row label="Order no">
              <span className="num">{line.orderNo}</span>
            </Row>
            <Row label="Sales person">{line.salesPerson || "—"}</Row>
            <Row label="Quality">{line.fabric}</Row>
            <Row label="Design matching">
              <span className="num">{line.design}</span>
            </Row>
            <Row label="Mtr / yard">
              <span className="num">{formatNumber(Number(line.qtyMtr))}</span>
            </Row>
            {line.haste ? <Row label="Haste">{line.haste}</Row> : null}
            {line.challanNo ? (
              <Row label="Challan no">
                <span className="num">{line.challanNo}</span>
              </Row>
            ) : null}
            {line.lotNo ? (
              <Row label="Lot no">
                <span className="num">{line.lotNo}</span>
              </Row>
            ) : null}
          </div>
        </div>

        {/* The seven stages in order. The connector is drawn in the completed
            colour only where the work has actually got to, so the run of green
            reads as progress at a glance. */}
        <div className="mt-4">
          <SectionLabel>Progress</SectionLabel>
          <ol className="relative mt-2">
            {STAGE_COLUMNS.map((c, i) => {
              const v = stageValue(c.key, byKey.get(c.key));
              const last = i === STAGE_COLUMNS.length - 1;
              return (
                <li key={c.key} className="relative flex gap-3 pb-3 last:pb-0">
                  {!last ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-6 left-[11px] h-full w-px",
                        v.tone === "done" ? "bg-success/40" : "bg-line",
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-[1] mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                      DOT[v.tone],
                    )}
                  >
                    {v.tone === "done" ? (
                      <CheckIcon className="size-3" strokeWidth={3} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 border-b border-line pb-2.5">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {c.full}
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn("text-[12px] font-semibold", VALUE[v.tone])}
                      >
                        {v.text}
                      </span>
                      {v.sub ? (
                        <span className="num ml-1.5 text-[11px] font-normal text-ink-muted">
                          {v.sub}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {group && group.lines.length > 1 ? (
          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <SectionLabel>Colours in {group.fabric}</SectionLabel>
              <span className="num text-[11px] font-medium text-ink-soft">
                {group.dispatched}/{group.lines.length} dispatched
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.lines.map((l) => (
                <ColourChip
                  key={l.lineId}
                  line={l}
                  active={l.lineId === line.lineId}
                  onClick={() => onSelectLine(l.lineId)}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              ✓ dispatched · • not yet — click one to open it
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One colour (design/matching) with its dispatch state on its face.
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
        "num inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[11px] font-semibold ring-1 transition-colors ring-inset",
        cancelled
          ? "bg-inset text-ink-muted line-through ring-line"
          : out
            ? "bg-success/12 text-success ring-success/30 hover:bg-success/20"
            : "bg-inset text-ink-soft ring-line hover:bg-line/40",
        active && "ring-2 ring-accent",
      )}
    >
      <span aria-hidden>{cancelled ? "–" : out ? "✓" : "•"}</span>
      {line.design}
    </button>
  );
}
