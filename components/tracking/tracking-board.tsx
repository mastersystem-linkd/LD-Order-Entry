"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, LockIcon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  formatDate,
  formatDateTime,
  formatDelay,
  formatNumber,
  type OperationsStatus,
  type OrderTracking,
  type StockStatus,
  type TrackingLine,
  type TrackingStage,
} from "@/lib/orders";
import { hasCap, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Reveal } from "@/components/ui/reveal";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Th } from "@/components/ui/table";

// Per-stage dot colours (CLAUDE.md §9).
const STAGE_DOT: Record<string, string> = {
  order_entry: "bg-indigo-500",
  stock_checking: "bg-blue-500",
  rolling_checking: "bg-amber-500",
  challan: "bg-rose-500",
  bill: "bg-emerald-500",
  dispatch: "bg-violet-500",
  received_lr: "bg-cyan-500",
};

// Per-stage status that drives the cell COLOUR (the dates move to a hover tip).
type CellState =
  | "done_ontime"
  | "done_late"
  | "live"
  | "overdue"
  | "out_of_stock"
  | "locked"
  | "pending";

// Cell colour. Gating is stock-only: order entry + stock checking are always
// editable ("live"); the stages after stock stay "locked" until this line's
// stock is In stock, then they open in any order.
function cellState(
  stage: TrackingStage,
  key: string,
  stockInStock: boolean,
): CellState {
  if (stage.is_done)
    return (stage.delay_minutes ?? 0) > 0 ? "done_late" : "done_ontime";
  const isStock = key === "stock_checking";
  if (isStock && stage.stock_status === "out_of_stock") return "out_of_stock";
  const editable = key === "order_entry" || isStock || stockInStock;
  if (!editable) return "locked";
  const p = stage.planned_at ? new Date(stage.planned_at).getTime() : 0;
  return p && p < Date.now() ? "overdue" : "live";
}

type ToggleVars = {
  lineId: string;
  stageKey: string;
  checked: boolean;
  stockStatus?: StockStatus | null;
};

// Client mirrors of computeLineStatus / computeOrderStatus (lib/workflow.ts is
// server-only — it pulls in the DB pool — so we can't import it here).
function lineStatusOf(stages: { is_done: boolean }[]): OperationsStatus {
  const done = stages.filter((s) => s.is_done).length;
  if (done === 0) return "PENDING";
  if (done === stages.length) return "COMPLETED";
  return "PARTIALLY COMPLETED";
}
function orderStatusOf(statuses: OperationsStatus[]): OperationsStatus {
  if (statuses.length === 0) return "PENDING";
  if (statuses.every((s) => s === "COMPLETED")) return "COMPLETED";
  if (statuses.every((s) => s === "PENDING")) return "PENDING";
  return "PARTIALLY COMPLETED";
}

// Signed delay in whole minutes (positive = late), mirroring the server's
// computeDelayMinutes with actual = now — so the delay pill is right on click.
function optimisticDelay(plannedAt: string | null): number {
  if (!plannedAt) return 0;
  return Math.round((Date.now() - new Date(plannedAt).getTime()) / 60000);
}

// Apply a stage toggle to the cached tracking data so the UI reacts instantly,
// mirroring the server. Reconciled by the background refetch on settle.
function applyOptimisticToggle(
  data: OrderTracking,
  vars: ToggleVars,
): OrderTracking {
  const nowIso = new Date().toISOString();
  const lines = data.lines.map((line) => {
    if (line.id !== vars.lineId) return line;
    const isStock = vars.stageKey === "stock_checking";
    const becomingDone = isStock
      ? vars.stockStatus === "in_stock"
      : vars.checked;
    const stages = line.stages.map((s) =>
      s.stage_key === vars.stageKey
        ? {
            ...s,
            is_done: becomingDone,
            stock_status: isStock
              ? becomingDone
                ? ("in_stock" as StockStatus)
                : (vars.stockStatus ?? null)
              : s.stock_status,
            actual_at: becomingDone ? (s.actual_at ?? nowIso) : null,
            delay_minutes: becomingDone
              ? (s.actual_at ? s.delay_minutes : optimisticDelay(s.planned_at))
              : null,
          }
        : s,
    );
    // Reverting stock no longer clears the stages after it — they stay done and
    // the line drops to PARTIALLY COMPLETED (surfaced by a confirm popup).
    return { ...line, stages, operations_status: lineStatusOf(stages) };
  });
  const operations_status = orderStatusOf(
    lines.filter((l) => !l.is_cancelled).map((l) => l.operations_status),
  );
  return { ...data, lines, operations_status };
}

// Border + tint + text per status (green done, amber late, indigo live, red
// overdue / out-of-stock, grey locked, neutral pending).
const CELL_TONE: Record<CellState, string> = {
  done_ontime: "border-success/30 bg-success/5 text-success",
  done_late: "border-warning/40 bg-warning/5 text-warning",
  live: "border-accent/40 bg-accent/5 text-accent",
  overdue: "border-danger/40 bg-danger/5 text-danger",
  out_of_stock: "border-danger/40 bg-danger/5 text-danger",
  locked: "border-line bg-surface-2 text-ink-muted",
  pending: "border-line bg-surface-2 text-ink-soft",
};
const STATE_LABEL: Record<CellState, string> = {
  done_ontime: "Done",
  done_late: "Done",
  live: "Live",
  overdue: "Overdue",
  out_of_stock: "Out of stock",
  locked: "Locked",
  pending: "Pending",
};

// Legend swatches — a touch stronger than the cell fill so the tiny key chips
// read clearly. Shown above the grid so users can decode the cell colours.
const LEGEND_SWATCH: Record<CellState, string> = {
  done_ontime: "border-success/50 bg-success/20",
  done_late: "border-warning/50 bg-warning/20",
  live: "border-accent/50 bg-accent/20",
  overdue: "border-danger/50 bg-danger/20",
  out_of_stock: "border-danger/50 bg-danger/20",
  locked: "border-line-strong bg-inset",
  pending: "border-line bg-surface-2",
};
const LEGEND: { state: CellState; label: string; hint: string }[] = [
  { state: "done_ontime", label: "Done", hint: "Completed on time" },
  {
    state: "done_late",
    label: "Done late",
    hint: "Completed after the planned date (delay shown as +Xm)",
  },
  { state: "live", label: "Live", hint: "The current stage to work on" },
  {
    state: "overdue",
    label: "Overdue",
    hint: "Current stage is past its planned date",
  },
  {
    state: "out_of_stock",
    label: "Out of stock",
    hint: "Stock checking is blocked; later stages stay locked",
  },
  {
    state: "locked",
    label: "Locked",
    hint: "Set Stock checking to In stock to unlock",
  },
];

export function TrackingBoard({
  orderId,
  caps,
}: {
  orderId: string;
  caps: Capability[];
}) {
  const queryClient = useQueryClient();
  const canEdit = hasCap(caps, "operations.edit");
  // Cells with an in-flight toggle (each shows its own spinner). A ref counts
  // total in-flight toggles so we only reconcile after the LAST one settles.
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  const inFlight = React.useRef(0);
  const [columnPending, setColumnPending] = React.useState<string | null>(null);
  // Mobile: which line item's 7-stage workflow is currently open (defaults to
  // the first active line).
  const [mobileLineId, setMobileLineId] = React.useState<string | null>(null);
  // A stock downgrade (Pending / Out of stock) on a line that already has stages
  // completed after stock checking pops a confirm — those stages stay done but
  // the line becomes Partially completed.
  const [stockWarn, setStockWarn] = React.useState<{
    lineId: string;
    stockStatus: StockStatus | null;
    label: string;
  } | null>(null);

  const tracking = useQuery({
    queryKey: ["tracking", orderId],
    queryFn: () => apiGet<OrderTracking>(`/api/orders/${orderId}/tracking`),
  });

  const toggle = useMutation<
    unknown,
    Error,
    ToggleVars,
    { prev?: OrderTracking }
  >({
    mutationFn: (vars) =>
      apiSend("/api/tracking/stage", "PATCH", {
        line_item_id: vars.lineId,
        stage_key: vars.stageKey,
        checked: vars.checked,
        stock_status: vars.stockStatus ?? null,
      }),
    // Optimistic: flip the cell in the cache immediately so it feels instant.
    onMutate: async (vars) => {
      const key = `${vars.lineId}:${vars.stageKey}`;
      inFlight.current += 1;
      setPending((p) => new Set(p).add(key));
      // Stop any in-flight refetch from clobbering the optimistic write.
      await queryClient.cancelQueries({ queryKey: ["tracking", orderId] });
      const prev = queryClient.getQueryData<OrderTracking>([
        "tracking",
        orderId,
      ]);
      if (prev)
        queryClient.setQueryData<OrderTracking>(
          ["tracking", orderId],
          applyOptimisticToggle(prev, vars),
        );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      // Instantly revert this cell; the settle below fetches server truth.
      if (ctx?.prev)
        queryClient.setQueryData(["tracking", orderId], ctx.prev);
      toast.error(err.message);
    },
    onSettled: (_data, _err, vars) => {
      inFlight.current -= 1;
      setPending((p) => {
        const n = new Set(p);
        n.delete(`${vars.lineId}:${vars.stageKey}`);
        return n;
      });
      // Reconcile only once the LAST in-flight toggle settles — one refetch for
      // a burst of clicks, and no refetch landing mid-edit (which would flicker).
      if (inFlight.current === 0) {
        queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      }
    },
  });

  // Mobile: when the fabric you're editing finishes all its stages, jump to the
  // next incomplete one. Only fires on the incomplete→complete transition of the
  // currently-open fabric — not when you tap an already-complete fabric to
  // review it. Hook lives above the early returns to satisfy the rules of hooks.
  const prevComplete = React.useRef<{ id: string | null; complete: boolean }>({
    id: null,
    complete: false,
  });
  // The line the mobile user last toggled — so we only auto-advance when THEIR
  // tap completed the open fabric, not when a background refetch (e.g. a
  // concurrent edit) flips it to complete under a user who's reviewing it.
  const lastToggledLineId = React.useRef<string | null>(null);
  React.useEffect(() => {
    const lines = tracking.data?.lines.filter((l) => !l.is_cancelled) ?? [];
    if (lines.length === 0) return;
    const sel = lines.find((l) => l.id === mobileLineId) ?? lines[0];
    const complete = sel.operations_status === "COMPLETED";
    const prev = prevComplete.current;
    const justCompleted =
      prev.id === sel.id &&
      !prev.complete &&
      complete &&
      lastToggledLineId.current === sel.id;
    prevComplete.current = { id: sel.id, complete };
    if (justCompleted) {
      lastToggledLineId.current = null;
      const next = lines.find(
        (l) => l.id !== sel.id && l.operations_status !== "COMPLETED",
      );
      if (next) setMobileLineId(next.id);
    }
  }, [tracking.data, mobileLineId]);

  if (tracking.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> Loading workflow…
      </div>
    );
  }
  if (tracking.isError || !tracking.data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-danger">
          {(tracking.error as Error)?.message ?? "Failed to load workflow."}
        </CardContent>
      </Card>
    );
  }

  const t = tracking.data;
  const active = t.lines.filter((l) => !l.is_cancelled);
  // Falls back to the first line if none picked yet, or if the picked line
  // disappeared after a refetch.
  const selectedMobileLine =
    active.find((l) => l.id === mobileLineId) ?? active[0];
  // Order-level fields surfaced as columns (constant across the order's lines).
  const meta = {
    designs: active.length,
    lotNo: t.order.lot_no ?? "",
    challanNo: t.order.challan_no ?? "",
    haste: t.order.haste ?? "",
  };

  // Header check-all state. Measured over the lines that can actually carry
  // this stage (editable now, or already done) — NOT every line. Otherwise an
  // out-of-stock line (which can never complete a post-stock stage) keeps the
  // "all done" state permanently out of reach, so the header checkbox never
  // shows as checked and clicking it can only ever mark-done, never un-check.
  function columnState(stageKey: string) {
    let inPlay = 0;
    let inPlayDone = 0;
    let anyDone = 0;
    for (const l of active) {
      const byKey = new Map(l.stages.map((s) => [s.stage_key, s]));
      const isDone = byKey.get(stageKey)?.is_done ?? false;
      if (isDone) anyDone += 1;
      const stockInStock = byKey.get("stock_checking")?.is_done ?? false;
      const canComplete =
        stageKey === "order_entry" ||
        stageKey === "stock_checking" ||
        stockInStock;
      if (canComplete || isDone) {
        inPlay += 1;
        if (isDone) inPlayDone += 1;
      }
    }
    const allDone = inPlay > 0 && inPlayDone === inPlay;
    return { all: allDone, some: anyDone > 0 && !allDone };
  }

  // Toggle a whole stage column (stock-only gating). Marking done: only lines
  // where this cell is editable — order entry always; the stages after stock
  // need that line's stock In stock (others are skipped). Un-marking: any line
  // currently done for the stage. There is no per-column control for stock.
  async function toggleColumn(stageKey: string, checked: boolean) {
    const targets: typeof active = [];
    let skipped = 0;
    for (const line of active) {
      const byKey = new Map(line.stages.map((s) => [s.stage_key, s]));
      const isDoneNow = byKey.get(stageKey)?.is_done ?? false;
      if (checked) {
        if (isDoneNow) continue;
        const stockInStock = byKey.get("stock_checking")?.is_done ?? false;
        const editable =
          stageKey === "order_entry" ||
          stageKey === "stock_checking" ||
          stockInStock;
        if (editable) targets.push(line);
        else skipped += 1;
      } else {
        if (isDoneNow) targets.push(line);
      }
    }
    if (targets.length === 0) {
      if (skipped > 0)
        toast.error(
          `Skipped ${skipped} — set stock to In stock first for ${skipped === 1 ? "that line" : "those lines"}.`,
        );
      return;
    }
    setColumnPending(stageKey);
    try {
      await Promise.all(
        targets.map((l) =>
          apiSend("/api/tracking/stage", "PATCH", {
            line_item_id: l.id,
            stage_key: stageKey,
            checked,
            stock_status: null,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      if (checked && skipped > 0)
        toast.success(
          `Updated ${targets.length}; skipped ${skipped} (stock not In stock).`,
        );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setColumnPending(null);
    }
  }

  function applyStock(lineId: string, stockStatus: StockStatus | null) {
    lastToggledLineId.current = lineId;
    toggle.mutate({
      lineId,
      stageKey: "stock_checking",
      checked: stockStatus === "in_stock",
      stockStatus,
    });
  }
  // Dropping stock to Pending / Out of stock on a line that already has stages
  // done after stock checking → confirm first. Those stages stay done; the line
  // just becomes Partially completed.
  function requestStock(line: TrackingLine, stockStatus: StockStatus | null) {
    const stockIdx = t.stage_keys.indexOf("stock_checking");
    const downstreamDone =
      stockStatus !== "in_stock" &&
      line.stages.some(
        (s) => t.stage_keys.indexOf(s.stage_key) > stockIdx && s.is_done,
      );
    if (downstreamDone) {
      setStockWarn({
        lineId: line.id,
        stockStatus,
        label: `${line.quality} · ${line.design_no}`,
      });
      return;
    }
    applyStock(line.id, stockStatus);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Back to operations"
            render={<Link href="/tracking" />}
          >
            <ArrowLeftIcon />
          </Button>
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em] break-words text-ink">
            {t.order.order_no}
          </h2>
          <StatusBadge status={t.operations_status} />
        </div>
        <div className="text-sm font-medium break-words text-ink">
          {t.order.haste ? `${t.order.haste} · ` : ""}
          {t.order.order_date}
        </div>
      </div>

      {active.length === 0 ? (
        <Reveal index={0}>
          <Card data-size="sm">
            <CardContent className="px-6 py-10 text-center text-sm text-ink-muted">
              This order has no active line items to track.
            </CardContent>
          </Card>
        </Reveal>
      ) : (
        <>
          {/* Mobile: order summary + legend, a fabric selector (one button per
              line), then the selected fabric's 7 stages stacked vertically —
              one fabric at a time, no horizontal scrolling. */}
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-sm">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                <span className="num">
                  {meta.designs} design{meta.designs === 1 ? "" : "s"}
                </span>
                <span>· Lot {meta.lotNo || "—"}</span>
                <span>· Challan {meta.challanNo || "—"}</span>
                <span>· Haste {meta.haste || "—"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2 text-[11px] text-ink-soft">
                <LegendChips />
              </div>
            </div>
            {/* Fabric selector — tap to switch which line's stages you edit;
                a button turns green once all its stages are done, so it also
                works as an at-a-glance progress overview. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {active.map((line) => {
                const complete = line.operations_status === "COMPLETED";
                const done = line.stages.filter((s) => s.is_done).length;
                const isSel = line.id === selectedMobileLine?.id;
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => setMobileLineId(line.id)}
                    aria-pressed={isSel}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-[10px] border px-2.5 py-2 text-left transition-colors",
                      complete
                        ? "border-success/40 bg-success/10 text-success"
                        : isSel
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line bg-surface-2 text-ink hover:border-line-strong",
                      isSel && "ring-2 ring-inset ring-[var(--accent-ring)]",
                    )}
                  >
                    <span className="flex items-center gap-1 text-[13px] font-semibold">
                      {complete ? (
                        <CheckIcon className="size-3.5 shrink-0" />
                      ) : null}
                      <span className="truncate">{line.quality}</span>
                    </span>
                    <span className="num text-[11px] font-medium opacity-80">
                      {line.design_no} · {done}/{t.stage_keys.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected fabric's 7-stage workflow (one at a time) */}
            {selectedMobileLine ? (
              <MobileLineCard
                key={selectedMobileLine.id}
                line={selectedMobileLine}
                stageKeys={t.stage_keys}
                canEdit={canEdit}
                pending={pending}
                onToggle={(stageKey, checked) => {
                  lastToggledLineId.current = selectedMobileLine.id;
                  toggle.mutate({
                    lineId: selectedMobileLine.id,
                    stageKey,
                    checked,
                  });
                }}
                onStock={(stockStatus) =>
                  requestStock(selectedMobileLine, stockStatus)
                }
              />
            ) : null}
          </div>

          {/* Desktop: full 7-stage matrix */}
          <Reveal index={0}>
            <Card data-size="sm" className="hidden lg:block">
              <CardContent className="px-0 pt-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 pb-2.5 pt-0.5 text-[11px] text-ink-soft">
                  <LegendChips />
                </div>
                <div className="max-h-[72vh] overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-surface">
                    <tr className="border-b border-line">
                      <Th className="sticky left-0 z-30 bg-surface px-4 shadow-[1px_0_0_var(--line)]">
                        Quality
                      </Th>
                      <Th>Design</Th>
                      <Th className="text-right">Qty</Th>
                      <Th>Status</Th>
                      {t.stage_keys.map((key) => {
                        const label =
                          active[0]?.stages.find((s) => s.stage_key === key)
                            ?.label ?? key;
                        const cs = columnState(key);
                        // Stock checking has no check-all — it's a per-line
                        // dropdown (Pending / In stock / Out of stock).
                        const showCheckAll =
                          canEdit && key !== "stock_checking";
                        return (
                          <Th key={key} className="px-2.5">
                            <div className="flex items-center gap-2">
                              {showCheckAll ? (
                                columnPending === key ? (
                                  <Spinner className="size-3.5" />
                                ) : (
                                  <input
                                    type="checkbox"
                                    checked={cs.all}
                                    ref={(el) => {
                                      if (el) el.indeterminate = cs.some;
                                    }}
                                    onChange={(e) =>
                                      toggleColumn(key, e.target.checked)
                                    }
                                    title="Mark all line items for this stage"
                                    aria-label={`Toggle all — ${label}`}
                                    className="size-3.5 shrink-0 accent-[var(--accent)]"
                                  />
                                )
                              ) : null}
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "size-2 shrink-0 rounded-full",
                                    STAGE_DOT[key] ?? "bg-ink-muted",
                                  )}
                                />
                                {label}
                              </span>
                            </div>
                          </Th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((line) => (
                      <LineRow
                        key={line.id}
                        line={line}
                        stageKeys={t.stage_keys}
                        canEdit={canEdit}
                        pending={pending}
                        onToggle={(stageKey, checked) =>
                          toggle.mutate({ lineId: line.id, stageKey, checked })
                        }
                        onStock={(stockStatus) =>
                          requestStock(line, stockStatus)
                        }
                      />
                    ))}
                  </tbody>
                </table>
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </>
      )}

      {/* Stock downgrade with completed later stages → confirm + flag. */}
      <Dialog
        open={!!stockWarn}
        onOpenChange={(open) => {
          if (!open) setStockWarn(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change stock status?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-ink">{stockWarn?.label}</span>{" "}
              already has stages completed after stock checking. Marking stock as{" "}
              <span className="font-medium text-ink">
                {stockWarn?.stockStatus === "out_of_stock"
                  ? "Out of stock"
                  : "Pending"}
              </span>{" "}
              keeps those stages completed, but this line will be flagged{" "}
              <span className="font-medium text-warning">
                Partially completed
              </span>
              .
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockWarn(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (stockWarn)
                  applyStock(stockWarn.lineId, stockWarn.stockStatus);
                setStockWarn(null);
              }}
            >
              Change stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineRow({
  line,
  stageKeys,
  canEdit,
  pending,
  onToggle,
  onStock,
}: {
  line: TrackingLine;
  stageKeys: string[];
  canEdit: boolean;
  pending: Set<string>;
  onToggle: (stageKey: string, checked: boolean) => void;
  onStock: (status: StockStatus | null) => void;
}) {
  const stageByKey = new Map(line.stages.map((s) => [s.stage_key, s]));
  // Stock-only gating: stages after stock checking unlock once stock is In stock.
  const stockInStock = stageByKey.get("stock_checking")?.is_done ?? false;
  const doneCount = line.stages.filter((s) => s.is_done).length;

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="sticky left-0 z-10 bg-surface px-4 py-3 shadow-[1px_0_0_var(--line)]">
        <div className="font-medium whitespace-nowrap text-ink">
          {line.quality}
        </div>
      </td>
      <td className="num px-3 py-3 whitespace-nowrap text-ink">
        {line.design_no}
      </td>
      <td className="num px-3 py-3 text-right whitespace-nowrap text-ink">
        {formatNumber(Number(line.qty_mtr))} mtr
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <StatusBadge status={line.operations_status} />
          <span className="num text-[11px] font-medium text-ink-soft">
            {doneCount}/{stageKeys.length} done
          </span>
        </div>
      </td>
      {stageKeys.map((key) => {
        const stage = stageByKey.get(key);
        if (!stage) return <td key={key} className="px-2.5 py-3" />;
        const state = cellState(stage, key, stockInStock);
        // Editable: order entry + stock always; stages after stock once In
        // stock; plus any already-done cell so it can be un-checked.
        const editable =
          key === "order_entry" ||
          key === "stock_checking" ||
          stockInStock ||
          stage.is_done;
        return (
          <StageCell
            key={key}
            stage={stage}
            state={state}
            isStock={key === "stock_checking"}
            locked={!editable}
            canEdit={canEdit}
            isPending={pending.has(`${line.id}:${key}`)}
            onToggle={(checked) => onToggle(key, checked)}
            onStock={onStock}
          />
        );
      })}
    </tr>
  );
}

function StageCell({
  stage,
  state,
  isStock,
  locked,
  canEdit,
  isPending,
  onToggle,
  onStock,
}: {
  stage: TrackingStage;
  state: CellState;
  isStock: boolean;
  locked: boolean;
  canEdit: boolean;
  isPending: boolean;
  onToggle: (checked: boolean) => void;
  onStock: (status: StockStatus | null) => void;
}) {
  const done = stage.is_done;
  const disabled = !canEdit || locked;
  const value: StockStatus | null =
    stage.stock_status ?? (done ? "in_stock" : null);
  // Dates hidden from the cell — surfaced on hover instead.
  const tip = `${stage.label} — ${STATE_LABEL[state]} · Plan: ${formatDate(stage.planned_at)} · Actual: ${formatDateTime(stage.actual_at)}`;
  // Every cell is one fixed-height row of the same width, so the grid stays
  // uniform whether or not a cell carries a delay pill (the pill sits inline
  // next to the label, never on a second line).
  const boxCls = cn(
    "flex h-10 w-full min-w-[164px] items-center gap-1.5 rounded-[10px] border px-2 transition-colors",
    CELL_TONE[state],
    disabled && !done && state !== "out_of_stock" && "opacity-70",
  );
  const pendingDot = isPending ? (
    <span
      aria-hidden
      className="size-1.5 shrink-0 rounded-full bg-accent/50 motion-safe:animate-pulse"
    />
  ) : null;
  const pill =
    done && (stage.delay_minutes ?? 0) > 0 ? (
      <DelayPill minutes={stage.delay_minutes} />
    ) : state === "out_of_stock" ? (
      <span className="inline-flex shrink-0 rounded-pill bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
        Blocked
      </span>
    ) : null;

  // Stock checking stays a 3-way dropdown (can't be a single toggle).
  if (isStock) {
    return (
      <td className="px-2 py-1.5 align-middle">
        <div title={tip} className={boxCls}>
          <select
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onStock((e.target.value || null) as StockStatus | null)
            }
            aria-label="Stock status"
            className="h-6 w-[92px] shrink-0 rounded-md border border-line-strong bg-surface px-1 text-[11px] font-medium text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-80"
          >
            <option value="">Pending</option>
            <option value="in_stock">In stock</option>
            <option value="out_of_stock">Out of stock</option>
          </select>
          {pill}
          {pendingDot ? <span className="ml-auto">{pendingDot}</span> : null}
        </div>
      </td>
    );
  }

  // Non-stock: the whole cell is the toggle — click anywhere to mark done / undo.
  return (
    <td className="px-2 py-1.5 align-middle">
      <button
        type="button"
        title={tip}
        disabled={disabled}
        aria-pressed={done}
        aria-label={`${stage.label} — ${STATE_LABEL[state]}`}
        onClick={() => onToggle(!done)}
        className={cn(
          boxCls,
          "text-left",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <CheckBox checked={done} />
        <span className="shrink-0 text-[11px] font-medium text-ink">
          {STATE_LABEL[state]}
        </span>
        {pill}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {pendingDot}
          {locked && !done ? (
            <LockIcon className="size-3 text-ink-muted" />
          ) : null}
        </span>
      </button>
    </td>
  );
}

// A checkbox-styled indicator (not a real input) so the whole cell/button can
// own the click.
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors",
        checked
          ? "border-accent bg-accent text-white"
          : "border-line-strong bg-surface",
      )}
    >
      {checked ? <CheckIcon className="size-2.5" /> : null}
    </span>
  );
}

function DelayPill({ minutes }: { minutes: number | null }) {
  const late = (minutes ?? 0) > 0;
  return (
    <span
      className={cn(
        "num inline-flex w-fit rounded-pill px-1.5 py-0.5 text-[10px] font-medium",
        late ? "bg-warning/15 text-warning" : "bg-success/15 text-success",
      )}
    >
      {formatDelay(minutes)}
    </span>
  );
}

// The colour key, shared by the desktop matrix and the mobile cards.
function LegendChips() {
  return (
    <>
      <span className="font-semibold tracking-[0.04em] text-ink-muted uppercase">
        Legend
      </span>
      {LEGEND.map(({ state, label, hint }) => (
        <span
          key={state}
          title={hint}
          className="inline-flex items-center gap-1.5"
        >
          <span
            className={cn("size-3 rounded-[4px] border", LEGEND_SWATCH[state])}
          />
          {label}
        </span>
      ))}
    </>
  );
}

// Mobile equivalent of a matrix row: one card per line item, its 7 stages
// stacked vertically so nothing needs horizontal scrolling.
function MobileLineCard({
  line,
  stageKeys,
  canEdit,
  pending,
  onToggle,
  onStock,
}: {
  line: TrackingLine;
  stageKeys: string[];
  canEdit: boolean;
  pending: Set<string>;
  onToggle: (stageKey: string, checked: boolean) => void;
  onStock: (status: StockStatus | null) => void;
}) {
  const stageByKey = new Map(line.stages.map((s) => [s.stage_key, s]));
  // Same stock-only gating as the desktop row.
  const stockInStock = stageByKey.get("stock_checking")?.is_done ?? false;
  const doneCount = line.stages.filter((s) => s.is_done).length;

  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{line.quality}</div>
          <div className="num text-[12px] text-ink-soft">
            {line.design_no} · {formatNumber(Number(line.qty_mtr))} mtr
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={line.operations_status} />
          <span className="num text-[11px] font-medium text-ink-soft">
            {doneCount}/{stageKeys.length} done
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {stageKeys.map((key) => {
          const stage = stageByKey.get(key);
          if (!stage) return null;
          const state = cellState(stage, key, stockInStock);
          const editable =
            key === "order_entry" ||
            key === "stock_checking" ||
            stockInStock ||
            stage.is_done;
          return (
            <MobileStageRow
              key={key}
              stageKey={key}
              stage={stage}
              state={state}
              isStock={key === "stock_checking"}
              locked={!editable}
              canEdit={canEdit}
              isPending={pending.has(`${line.id}:${key}`)}
              onToggle={(checked) => onToggle(key, checked)}
              onStock={onStock}
            />
          );
        })}
      </div>
    </div>
  );
}

function MobileStageRow({
  stageKey,
  stage,
  state,
  isStock,
  locked,
  canEdit,
  isPending,
  onToggle,
  onStock,
}: {
  stageKey: string;
  stage: TrackingStage;
  state: CellState;
  isStock: boolean;
  locked: boolean;
  canEdit: boolean;
  isPending: boolean;
  onToggle: (checked: boolean) => void;
  onStock: (status: StockStatus | null) => void;
}) {
  const done = stage.is_done;
  const disabled = !canEdit || locked;
  const value: StockStatus | null =
    stage.stock_status ?? (done ? "in_stock" : null);
  const boxCls = cn(
    "flex flex-col gap-1.5 rounded-[10px] border p-2.5 text-left transition-colors",
    CELL_TONE[state],
    disabled && !done && state !== "out_of_stock" && "opacity-70",
  );
  const header = (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          STAGE_DOT[stageKey] ?? "bg-ink-muted",
        )}
      />
      {stage.label}
    </span>
  );
  const dates = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
      <span className="num">Plan {formatDate(stage.planned_at)}</span>
      <span className="num">Actual {formatDateTime(stage.actual_at)}</span>
      {done && (stage.delay_minutes ?? 0) > 0 ? (
        <DelayPill minutes={stage.delay_minutes} />
      ) : null}
      {state === "out_of_stock" ? (
        <span className="inline-flex w-fit rounded-pill bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger">
          Blocked
        </span>
      ) : null}
    </div>
  );

  if (isStock) {
    return (
      <div className={boxCls}>
        <div className="flex items-center justify-between gap-2">
          {header}
          <div className="flex items-center gap-1.5">
            <select
              value={value ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onStock((e.target.value || null) as StockStatus | null)
              }
              aria-label="Stock status"
              className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[11px] font-medium text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-80"
            >
              <option value="">Pending</option>
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
            {isPending ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-accent/50 motion-safe:animate-pulse"
            />
          ) : null}
          </div>
        </div>
        {dates}
      </div>
    );
  }

  // Non-stock: tap anywhere on the row to mark done / undo.
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={done}
      aria-label={`${stage.label} — ${STATE_LABEL[state]}`}
      onClick={() => onToggle(!done)}
      className={cn(boxCls, disabled ? "cursor-not-allowed" : "cursor-pointer")}
    >
      <div className="flex items-center justify-between gap-2">
        {header}
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
          {isPending ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-accent/50 motion-safe:animate-pulse"
            />
          ) : null}
          {locked && !done ? (
            <LockIcon className="size-3 shrink-0 text-ink-muted" />
          ) : null}
          <CheckBox checked={done} />
          {STATE_LABEL[state]}
        </span>
      </div>
      {dates}
    </button>
  );
}
