"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  formatDate,
  formatDateTime,
  formatDelay,
  formatNumber,
  type OrderTracking,
  type TrackingLine,
  type TrackingStage,
} from "@/lib/orders";
import type { Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";

// Vivid per-stage dot colours (CLAUDE.md §9) — readable in light and dark,
// unlike pale tinted pills. Paired with a bold dark label in the header.
const STAGE_DOT: Record<string, string> = {
  order_entry: "bg-indigo-500",
  stock_checking: "bg-blue-500",
  rolling_checking: "bg-amber-500",
  challan: "bg-rose-500",
  bill: "bg-emerald-500",
  dispatch: "bg-violet-500",
  received_lr: "bg-cyan-500",
};

export function TrackingBoard({
  orderId,
  role,
}: {
  orderId: string;
  role: Role;
}) {
  const queryClient = useQueryClient();
  const canEdit = role === "ADMIN" || role === "OPS";
  const [pending, setPending] = React.useState<string | null>(null);
  const [columnPending, setColumnPending] = React.useState<string | null>(null);

  const tracking = useQuery({
    queryKey: ["tracking", orderId],
    queryFn: () => apiGet<OrderTracking>(`/api/orders/${orderId}/tracking`),
  });

  const toggle = useMutation({
    mutationFn: (vars: { lineId: string; stageKey: string; checked: boolean }) =>
      apiSend("/api/tracking/stage", "PATCH", {
        line_item_id: vars.lineId,
        stage_key: vars.stageKey,
        checked: vars.checked,
      }),
    onMutate: (vars) => setPending(`${vars.lineId}:${vars.stageKey}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setPending(null),
  });

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

  // Per-column "check all": completion state across all active lines for a stage.
  function columnState(stageKey: string) {
    const states = active.map(
      (l) => l.stages.find((s) => s.stage_key === stageKey)?.is_done ?? false,
    );
    const done = states.filter(Boolean).length;
    return {
      all: states.length > 0 && done === states.length,
      some: done > 0 && done < states.length,
    };
  }

  // Toggle every line item for a stage at once (only the ones that differ).
  async function toggleColumn(stageKey: string, checked: boolean) {
    const targets = active.filter((l) => {
      const s = l.stages.find((x) => x.stage_key === stageKey);
      return s && s.is_done !== checked;
    });
    if (targets.length === 0) return;
    setColumnPending(stageKey);
    try {
      await Promise.all(
        targets.map((l) =>
          apiSend("/api/tracking/stage", "PATCH", {
            line_item_id: l.id,
            stage_key: stageKey,
            checked,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setColumnPending(null);
    }
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
        <div className="text-sm break-words text-ink-muted">
          {t.order.party_name} · {t.order.order_date}
          {t.order.department ? ` · ${t.order.department}` : ""}
        </div>
      </div>

      <Reveal index={0}>
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>7-stage workflow</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {active.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-ink-muted">
                This order has no active line items to track.
              </div>
            ) : (
              <div className="max-h-[72vh] overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-surface">
                    <tr className="border-b border-line">
                      <th className="sticky left-0 z-30 bg-surface px-4 py-2.5 text-[12px] font-semibold whitespace-nowrap text-ink shadow-[1px_0_0_var(--line)]">
                        Line item
                      </th>
                      <th className="px-3 py-2.5 text-right text-[12px] font-semibold whitespace-nowrap text-ink">
                        Qty / Rate / Total
                      </th>
                      <th className="px-3 py-2.5 text-[12px] font-semibold whitespace-nowrap text-ink">
                        Status
                      </th>
                      {t.stage_keys.map((key) => {
                        const label =
                          active[0]?.stages.find((s) => s.stage_key === key)
                            ?.label ?? key;
                        const cs = columnState(key);
                        return (
                          <th
                            key={key}
                            className="px-2.5 py-2.5 whitespace-nowrap"
                          >
                            <div className="flex items-center gap-2">
                              {canEdit ? (
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
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                                <span
                                  className={cn(
                                    "size-2 shrink-0 rounded-full",
                                    STAGE_DOT[key] ?? "bg-ink-muted",
                                  )}
                                />
                                {label}
                              </span>
                            </div>
                          </th>
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
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </Reveal>
    </div>
  );
}

function LineRow({
  line,
  stageKeys,
  canEdit,
  pending,
  onToggle,
}: {
  line: TrackingLine;
  stageKeys: string[];
  canEdit: boolean;
  pending: string | null;
  onToggle: (stageKey: string, checked: boolean) => void;
}) {
  const stageByKey = new Map(line.stages.map((s) => [s.stage_key, s]));
  const liveKey = stageKeys.find((k) => !stageByKey.get(k)?.is_done) ?? null;
  const doneCount = line.stages.filter((s) => s.is_done).length;

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="sticky left-0 z-10 bg-surface px-4 py-3 shadow-[1px_0_0_var(--line)]">
        <div className="font-medium whitespace-nowrap text-ink">
          {line.quality}
        </div>
        <div className="whitespace-nowrap text-xs text-ink">
          {line.design_no}
        </div>
      </td>
      <td className="num px-3 py-3 text-right whitespace-nowrap text-ink">
        <div>{formatNumber(Number(line.qty_mtr))} mtr</div>
        <div className="text-xs text-ink-soft">
          {line.rate == null ? "—" : `₹${formatNumber(Number(line.rate))}`}
        </div>
        <div className="text-xs font-medium">
          {line.line_total == null
            ? "—"
            : `₹${formatNumber(Number(line.line_total))}`}
        </div>
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
        return (
          <StageCell
            key={key}
            stage={stage}
            isLive={key === liveKey}
            canEdit={canEdit}
            isPending={pending === `${line.id}:${key}`}
            onToggle={(checked) => onToggle(key, checked)}
          />
        );
      })}
    </tr>
  );
}

function StageCell({
  stage,
  isLive,
  canEdit,
  isPending,
  onToggle,
}: {
  stage: TrackingStage;
  isLive: boolean;
  canEdit: boolean;
  isPending: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const done = stage.is_done;

  return (
    <td className="px-2.5 py-3 align-top">
      <div
        className={cn(
          "flex min-w-[150px] flex-col gap-1.5 rounded-[10px] border p-2.5 transition-colors",
          done
            ? "border-success/30 bg-success/5"
            : isLive
              ? "border-accent/40 bg-accent/5"
              : "border-line bg-surface-2",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            {isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <input
                type="checkbox"
                checked={done}
                disabled={!canEdit}
                onChange={(e) => onToggle(e.target.checked)}
                className="size-3.5 accent-[var(--accent)] disabled:cursor-not-allowed"
              />
            )}
            {done ? "Done" : "Pending"}
          </label>
          {isLive && !done ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Live
            </span>
          ) : null}
        </div>

        <div className="text-[11px] leading-tight text-ink">
          <div>
            Planned: <span className="num">{formatDate(stage.planned_at)}</span>
          </div>
          <div>
            Actual:{" "}
            <span className="num">{formatDateTime(stage.actual_at)}</span>
          </div>
        </div>

        {done ? <DelayPill minutes={stage.delay_minutes} /> : null}
      </div>
    </td>
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
