"use client";

import * as React from "react";

import type { OrderStatusRow } from "@/lib/order-status";
import { cn } from "@/lib/utils";

// One column per stage, so short headers. The full names live in
// workflow_stages and are shown on hover and in the detail panel.
export const STAGE_COLUMNS: { key: string; short: string; full: string }[] = [
  { key: "order_entry", short: "Entry", full: "Order entry" },
  { key: "stock_checking", short: "Stock", full: "Stock checking" },
  { key: "rolling_checking", short: "Rolling", full: "Rolling & checking" },
  { key: "challan", short: "Challan", full: "Challan" },
  { key: "bill", short: "Bill", full: "Bill" },
  { key: "dispatch", short: "Dispatch", full: "Dispatch" },
  { key: "received_lr", short: "LR", full: "Received LR" },
];

export const STAGE_COL_WIDTH = 96;

// How far a set of designs has got through one stage. A quality row passes all
// its designs; a colour row passes just itself.
export function StageCell({
  lines,
  stageKey,
  label,
}: {
  lines: OrderStatusRow[];
  stageKey: string;
  label: string;
}) {
  const cells = lines.map((l) => l.stages.find((s) => s.stageKey === stageKey));
  const n = lines.length;
  const done = cells.filter((c) => c?.state === "done").length;
  const overdue = cells.some((c) => c?.state === "overdue");
  const all = n > 0 && done === n;
  const some = done > 0 && !all;

  const tone = all
    ? "bg-success/15 text-success"
    : some
      ? "bg-warning/15 text-warning"
      : overdue
        ? "bg-danger/15 text-danger"
        : "bg-inset text-ink-muted";

  // A single design is a yes/no; a group needs the count.
  const text = n === 1 ? (all ? "✓" : overdue ? "!" : "–") : all ? "✓" : `${done}/${n}`;

  return (
    <span
      title={
        n === 1
          ? `${label}: ${all ? "done" : overdue ? "overdue" : "not done"}`
          : `${label}: ${done} of ${n} designs done`
      }
      className={cn(
        "num inline-flex min-w-[44px] items-center justify-center rounded-pill px-2 py-1 text-[12px] font-semibold tabular-nums",
        tone,
      )}
    >
      {text}
    </span>
  );
}
