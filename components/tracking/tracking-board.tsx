"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Back to operations"
            render={<Link href="/tracking" />}
          >
            <ArrowLeftIcon />
          </Button>
          <h2 className="font-display text-lg font-medium tracking-[-0.02em]">
            {t.order.order_no}
          </h2>
          <StatusBadge status={t.operations_status} />
        </div>
        <div className="text-sm text-ink-muted">
          {t.order.party_name} · {t.order.order_date}
          {t.order.department ? ` · ${t.order.department}` : ""}
        </div>
      </div>

      <Reveal index={0}>
      <Card>
        <CardHeader>
          <CardTitle>7-stage workflow</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-line px-0">
          {active.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-ink-muted">
              This order has no active line items to track.
            </div>
          ) : (
            active.map((line) => (
              <LineTrack
                key={line.id}
                line={line}
                stageKeys={t.stage_keys}
                canEdit={canEdit}
                pending={pending}
                onToggle={(stageKey, checked) =>
                  toggle.mutate({ lineId: line.id, stageKey, checked })
                }
              />
            ))
          )}
        </CardContent>
      </Card>
      </Reveal>
    </div>
  );
}

function LineTrack({
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
    <div className="px-6 py-6">
      {/* Identity + progress summary */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-ink">
            {line.quality}
            <span className="font-normal text-ink-muted"> · {line.design_no}</span>
          </div>
          <div className="num mt-1 text-xs text-ink-soft">
            {formatNumber(Number(line.qty_mtr))} mtr
            {line.rate != null ? ` · ₹${formatNumber(Number(line.rate))}` : ""}
            {line.line_total != null
              ? ` · ₹${formatNumber(Number(line.line_total))}`
              : ""}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="num text-xs text-ink-muted">
            {doneCount}/{stageKeys.length}
          </span>
          <StatusBadge status={line.operations_status} />
        </div>
      </div>

      {/* Horizontal stepper */}
      <div className="mt-5 overflow-x-auto pb-1">
        <div className="grid min-w-[840px] grid-cols-7 gap-1">
          {stageKeys.map((key, i) => {
            const stage = stageByKey.get(key);
            if (!stage) return <div key={key} />;
            const prevDone = i > 0 && !!stageByKey.get(stageKeys[i - 1])?.is_done;
            return (
              <Step
                key={key}
                stage={stage}
                isFirst={i === 0}
                isLast={i === stageKeys.length - 1}
                prevDone={prevDone}
                isLive={key === liveKey}
                canEdit={canEdit}
                isPending={pending === `${line.id}:${key}`}
                onToggle={(checked) => onToggle(key, checked)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Step({
  stage,
  isFirst,
  isLast,
  prevDone,
  isLive,
  canEdit,
  isPending,
  onToggle,
}: {
  stage: TrackingStage;
  isFirst: boolean;
  isLast: boolean;
  prevDone: boolean;
  isLive: boolean;
  canEdit: boolean;
  isPending: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const done = stage.is_done;

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      {/* Rail + node */}
      <div className="flex w-full items-center">
        <span
          className={cn(
            "h-0.5 flex-1 rounded-full",
            isFirst ? "opacity-0" : prevDone ? "bg-accent" : "bg-line-strong",
          )}
        />
        <button
          type="button"
          disabled={!canEdit || isPending}
          onClick={() => onToggle(!done)}
          aria-label={`${stage.label} — ${done ? "done, click to undo" : "pending, click to mark done"}`}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border-2 transition",
            done
              ? "border-transparent bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-white shadow-[0_4px_12px_var(--glow)]"
              : isLive
                ? "border-accent bg-surface text-accent ring-4 ring-[var(--accent-ring)]"
                : "border-line-strong bg-surface-2 text-ink-muted",
            canEdit && !isPending
              ? "cursor-pointer hover:brightness-105"
              : "cursor-default",
          )}
        >
          {isPending ? (
            <Spinner className="size-4 text-current" />
          ) : done ? (
            <CheckIcon className="size-4" />
          ) : (
            <span className="size-2 rounded-full bg-current opacity-40" />
          )}
        </button>
        <span
          className={cn(
            "h-0.5 flex-1 rounded-full",
            isLast ? "opacity-0" : done ? "bg-accent" : "bg-line-strong",
          )}
        />
      </div>

      {/* Label + meta */}
      <div className="mt-2.5 flex flex-col items-center gap-1 px-1">
        <span
          className={cn(
            "text-[12px] font-medium leading-tight",
            done || isLive ? "text-ink" : "text-ink-soft",
          )}
        >
          {stage.label}
        </span>
        {done ? (
          <>
            <span className="num text-[11px] text-ink-soft">
              {formatDateTime(stage.actual_at)}
            </span>
            <DelayPill minutes={stage.delay_minutes} />
          </>
        ) : (
          <>
            <span className="num text-[11px] text-ink-muted">
              Plan {formatDate(stage.planned_at)}
            </span>
            {isLive ? (
              <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                Current
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function DelayPill({ minutes }: { minutes: number | null }) {
  const late = (minutes ?? 0) > 0;
  return (
    <span
      className={cn(
        "num rounded-pill px-1.5 py-0.5 text-[10px] font-medium",
        late
          ? "bg-warning/15 text-warning"
          : "bg-success/15 text-success",
      )}
    >
      {formatDelay(minutes)}
    </span>
  );
}
