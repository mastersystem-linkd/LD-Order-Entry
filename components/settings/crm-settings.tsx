"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";

// Settings → CRM (CLAUDE.md §12.2). Until this existed every knob below was
// SQL-only, which meant nobody but a developer could pause the reconcile or
// change when a follow-up escalates.

type CrmSettings = {
  transit_days_default: number;
  followup_due_days: number;
  max_attempts: number;
  escalate_rating_at: number;
  auto_create_followups: boolean;
  transport_transit_days: Record<string, number> | null;
  updated_at: string;
};

type NumKey = Exclude<
  keyof CrmSettings,
  "auto_create_followups" | "transport_transit_days" | "updated_at"
>;

const FIELDS: { key: NumKey; label: string; hint: string; min: number; max: number }[] = [
  {
    key: "transit_days_default",
    label: "Transit days",
    hint: "Days after dispatch before we assume the goods landed, when no LR is ticked.",
    min: 0,
    max: 60,
  },
  {
    key: "followup_due_days",
    label: "Call within",
    hint: "Days after delivery that a follow-up is due. A call three weeks later gets nothing useful.",
    min: 0,
    max: 60,
  },
  {
    key: "max_attempts",
    label: "Attempts before unreachable",
    hint: "Failed attempts before the follow-up moves to UNREACHABLE. Reopenable.",
    min: 1,
    max: 10,
  },
  {
    key: "escalate_rating_at",
    label: "Escalate at rating",
    hint: "An overall rating at or below this flags the follow-up for principal review.",
    min: 1,
    max: 5,
  },
];

export function CrmSettingsPanel() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = React.useState<Record<string, string>>({});
  const [auto, setAuto] = React.useState<boolean | null>(null);

  const settings = useQuery({
    queryKey: ["crm-settings"],
    queryFn: () => apiGet<CrmSettings>("/api/crm/settings"),
  });

  React.useEffect(() => {
    if (settings.data) {
      setEdited(
        Object.fromEntries(FIELDS.map((f) => [f.key, String(settings.data[f.key])])),
      );
      setAuto(settings.data.auto_create_followups);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (patch: Record<string, number | boolean>) =>
      apiSend<CrmSettings>("/api/crm/settings", "PATCH", patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-settings"] });
      queryClient.invalidateQueries({ queryKey: ["crm-followups"] });
      toast.success("CRM settings saved.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const current = settings.data;
  // Only send what actually moved — the schema rejects an empty patch, and a
  // full overwrite would clobber a value another admin changed meanwhile.
  const patch: Record<string, number | boolean> = {};
  if (current) {
    for (const f of FIELDS) {
      const raw = edited[f.key];
      if (raw === undefined || raw === "") continue;
      const n = Number(raw);
      if (!Number.isNaN(n) && n !== current[f.key]) patch[f.key] = n;
    }
    if (auto !== null && auto !== current.auto_create_followups) {
      patch.auto_create_followups = auto;
    }
  }
  const dirty = Object.keys(patch).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>CRM follow-ups</CardTitle>
          <span className="text-xs text-ink-muted">days, unless stated</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settings.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : (
            <>
              {FIELDS.map((f) => (
                <div
                  key={f.key}
                  className="flex items-start gap-3 rounded-field border border-line bg-surface-2 px-3 py-2.5"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium">{f.label}</div>
                    <p className="mt-0.5 text-xs text-ink-muted">{f.hint}</p>
                  </div>
                  <Input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step="1"
                    className="num mt-0.5 h-9 w-20 shrink-0 text-center"
                    value={edited[f.key] ?? ""}
                    onChange={(e) =>
                      setEdited((m) => ({ ...m, [f.key]: e.target.value }))
                    }
                  />
                </div>
              ))}

              <div className="flex items-start gap-3 rounded-field border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex-1">
                  <div className="text-sm font-medium">Create follow-ups automatically</div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Off pauses new follow-ups. Nothing already created is
                    deleted, and the queue keeps working.
                  </p>
                </div>
                <Segmented
                  ariaLabel="Create follow-ups automatically"
                  size="sm"
                  className="mt-0.5 shrink-0"
                  value={auto === null ? null : auto ? "on" : "off"}
                  onChange={(v) => setAuto(v === "on")}
                  options={[
                    { value: "on", label: "On" },
                    { value: "off", label: "Off" },
                  ]}
                />
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  onClick={() => save.mutate(patch)}
                  disabled={save.isPending || dirty === 0}
                >
                  {save.isPending ? (
                    <>
                      <Spinner className="text-white" /> Saving…
                    </>
                  ) : (
                    `Save${dirty ? ` (${dirty})` : ""}`
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What these change</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-ink-soft">
          <p>
            A follow-up is created when every active line on an order has landed
            — the LR is back, <i>or</i> dispatch happened and{" "}
            <b className="text-ink num">{edited.transit_days_default || "—"}</b>{" "}
            transit days have passed.
          </p>
          <p>
            It is then due{" "}
            <b className="text-ink num">{edited.followup_due_days || "—"}</b>{" "}
            days later, and goes overdue after that.
          </p>
          <p>
            After{" "}
            <b className="text-ink num">{edited.max_attempts || "—"}</b> failed
            attempts it becomes <b className="text-ink">Unreachable</b>; an
            overall rating of{" "}
            <b className="text-ink num">{edited.escalate_rating_at || "—"}</b> or
            below flags it for review.
          </p>
          <p className="text-xs text-ink-muted">
            Changing transit days re-dates <i>future</i> follow-ups only.
            Anything already in the queue keeps the delivery date it was created
            with, so the coordinator&rsquo;s list does not reshuffle under them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
