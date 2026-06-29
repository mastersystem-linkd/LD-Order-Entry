"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Stage = {
  stage_key: string;
  label: string;
  sort_order: number;
  planned_offset_days: number;
};

function previewDate(offsetDays: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

export function TimeTracking() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = React.useState<Record<string, string>>({});

  const stages = useQuery({
    queryKey: ["stages"],
    queryFn: () => apiGet<Stage[]>("/api/stages"),
  });

  // Seed local edit state once data arrives / changes.
  React.useEffect(() => {
    if (stages.data) {
      setEdited(
        Object.fromEntries(
          stages.data.map((s) => [s.stage_key, String(s.planned_offset_days)]),
        ),
      );
    }
  }, [stages.data]);

  const save = useMutation({
    mutationFn: async (changed: Stage[]) => {
      for (const s of changed) {
        await apiSend(`/api/stages/${s.stage_key}`, "PATCH", {
          planned_offset_days: Number(edited[s.stage_key]),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stages"] });
      toast.success("Time tracking saved. Applies to new orders.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recompute = useMutation({
    mutationFn: () =>
      apiSend<{ recomputed: number }>("/api/stages/recompute", "POST"),
    onSuccess: (res) =>
      toast.success(`Recomputed planned dates for ${res.recomputed} open stages.`),
    onError: (e: Error) => toast.error(e.message),
  });

  const data = stages.data ?? [];
  const changed = data.filter(
    (s) =>
      edited[s.stage_key] !== undefined &&
      Number(edited[s.stage_key]) !== s.planned_offset_days &&
      edited[s.stage_key] !== "",
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Time tracking (SLA)</CardTitle>
          <span className="text-xs text-ink-muted">days from order date</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stages.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : (
            <>
              {data.map((s) => (
                <div
                  key={s.stage_key}
                  className="flex items-center gap-3 rounded-field border border-line bg-surface-2 px-3 py-2"
                >
                  <span className="num grid size-7 place-items-center rounded-[8px] bg-accent-soft text-[12px] text-accent">
                    {s.sort_order}
                  </span>
                  <span className="flex-1 text-sm font-medium">{s.label}</span>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    className="num h-9 w-20 text-center"
                    value={edited[s.stage_key] ?? ""}
                    onChange={(e) =>
                      setEdited((m) => ({ ...m, [s.stage_key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="outline"
                  onClick={() => recompute.mutate()}
                  disabled={recompute.isPending}
                >
                  {recompute.isPending ? <Spinner /> : null} Recompute open orders
                </Button>
                <Button
                  onClick={() => save.mutate(changed)}
                  disabled={save.isPending || changed.length === 0}
                >
                  {save.isPending ? (
                    <>
                      <Spinner className="text-white" /> Saving…
                    </>
                  ) : (
                    `Save${changed.length ? ` (${changed.length})` : ""}`
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft">
            For an order dated <b className="text-ink">today</b>, planned dates
            would be:
          </p>
          <ul className="flex flex-col gap-1.5">
            {data.map((s) => {
              const off = Number(edited[s.stage_key]);
              const valid = edited[s.stage_key] !== "" && !Number.isNaN(off);
              return (
                <li
                  key={s.stage_key}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-ink-soft">{s.label}</span>
                  <span className="num font-medium text-ink">
                    {valid ? previewDate(off) : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Changes apply to new orders. Use “Recompute open orders” to apply to
            existing not-yet-done stages.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
