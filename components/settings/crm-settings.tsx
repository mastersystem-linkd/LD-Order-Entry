"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";

import { apiGet, apiSend } from "@/lib/api-client";
import { cn } from "@/lib/utils";
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

// ---------------------------------------------------------------------------
// The two lists the call panel is built from (§12.4, §12.5). Both were fixed
// vocabularies in code until migration 0005; neither could survive contact
// with real calls, so they are managed here.
// ---------------------------------------------------------------------------

type Criterion = {
  id: string;
  key: string;
  label: string;
  hint: string | null;
  sort_order: number;
  is_active: boolean;
};

function RatingCriteria() {
  const queryClient = useQueryClient();
  const [label, setLabel] = React.useState("");
  const [hint, setHint] = React.useState("");

  const q = useQuery({
    queryKey: ["crm-rating-criteria", "all"],
    queryFn: () => apiGet<Criterion[]>("/api/crm/rating-criteria?all=1"),
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["crm-rating-criteria"] });
    queryClient.invalidateQueries({ queryKey: ["crm-followup"] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiSend("/api/crm/rating-criteria", "POST", {
        label: label.trim(),
        hint: hint.trim() || null,
      }),
    onSuccess: () => {
      setLabel("");
      setHint("");
      done();
      toast.success("Criterion added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (c: Criterion) =>
      apiSend(`/api/crm/rating-criteria/${c.id}`, "PATCH", {
        is_active: !c.is_active,
      }),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: (v: { c: Criterion; to: number }) =>
      apiSend(`/api/crm/rating-criteria/${v.c.id}`, "PATCH", { sort_order: v.to }),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];
  const active = rows.filter((r) => r.is_active);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Rating criteria</CardTitle>
        <span className="text-xs text-ink-soft">{active.length} in use</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-ink-soft">
          What every delivered order is scored on, 1–5, on the call panel. The
          overall score is suggested as the mean of these and the coordinator
          may override it.
        </p>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Loading…
          </div>
        ) : (
          <>
            {rows.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  "flex items-center gap-3 rounded-field border border-line bg-surface-2 px-3 py-2",
                  !c.is_active && "opacity-55",
                )}
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0 || move.isPending}
                    onClick={() => move.mutate({ c, to: Math.max(0, c.sort_order - 1) })}
                    className="cursor-pointer text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === rows.length - 1 || move.isPending}
                    onClick={() => move.mutate({ c, to: c.sort_order + 1 })}
                    className="cursor-pointer text-ink-soft hover:text-ink disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.label}</div>
                  {c.hint ? (
                    <div className="text-xs text-ink-soft">{c.hint}</div>
                  ) : null}
                </div>
                {!c.is_active ? (
                  <span className="rounded-pill bg-inset px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft">
                    retired
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(c)}
                >
                  {c.is_active ? "Retire" : "Restore"}
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="New criterion, e.g. Billing accuracy"
                className="h-9 min-w-[200px] flex-1"
              />
              <Input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Short gloss (optional)"
                className="h-9 min-w-[160px] flex-1"
              />
              <Button
                disabled={!label.trim() || add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? <Spinner className="text-white" /> : null} Add
              </Button>
            </div>
            <p className="text-xs text-ink-soft">
              Retiring keeps every score already given and simply stops offering
              the row on new calls — the same way a deactivated dropdown value
              still reads correctly on the orders that used it. Nothing here is
              ever hard-deleted.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ManagedList({
  category,
  title,
  blurb,
  placeholder,
}: {
  category: string;
  title: string;
  blurb: React.ReactNode;
  placeholder: string;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState("");

  const q = useQuery({
    queryKey: ["lookups", category, "all"],
    queryFn: () =>
      apiGet<{ id: string; value: string; is_active: boolean }[]>(
        `/api/lookups?category=${category}&all=1`,
      ),
  });

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["lookups", category] });
    queryClient.invalidateQueries({ queryKey: ["crm-issues"] });
    queryClient.invalidateQueries({ queryKey: ["crm-followup"] });
  };

  const add = useMutation({
    mutationFn: () =>
      apiSend("/api/lookups", "POST", { category, value: value.trim() }),
    onSuccess: () => {
      setValue("");
      done();
      toast.success("Added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retire = useMutation({
    mutationFn: (r: { id: string; is_active: boolean }) =>
      apiSend(`/api/lookups/${r.id}`, "PATCH", { is_active: !r.is_active }),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-ink-soft">
          {rows.filter((r) => r.is_active).length} in use
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-ink-soft">{blurb}</p>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Loading…
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => (
                <span
                  key={r.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-2 py-1 pr-1 pl-2.5 text-[12.5px]",
                    !r.is_active && "opacity-50",
                  )}
                >
                  {r.value}
                  <button
                    type="button"
                    title={r.is_active ? "Retire" : "Restore"}
                    disabled={retire.isPending}
                    onClick={() => retire.mutate(r)}
                    className="cursor-pointer rounded-full p-0.5 text-ink-soft hover:bg-inset hover:text-ink"
                  >
                    {r.is_active ? (
                      <XIcon className="size-3" />
                    ) : (
                      <RotateCcwIcon className="size-3" />
                    )}
                  </button>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) add.mutate();
                }}
                placeholder={placeholder}
                className="h-9 min-w-[220px] flex-1"
              />
              <Button
                disabled={!value.trim() || add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? <Spinner className="text-white" /> : null} Add
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="flex flex-col gap-5">
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>CRM follow-ups</CardTitle>
          <span className="text-xs text-ink-soft">days, unless stated</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settings.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
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
                    <p className="mt-0.5 text-xs text-ink-soft">{f.hint}</p>
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
                  <p className="mt-0.5 text-xs text-ink-soft">
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
          <p className="text-xs text-ink-soft">
            Changing transit days re-dates <i>future</i> follow-ups only.
            Anything already in the queue keeps the delivery date it was created
            with, so the coordinator&rsquo;s list does not reshuffle under them.
          </p>
        </CardContent>
      </Card>
    </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RatingCriteria />
        <ManagedList
          category="CRM_ISSUE"
          title="Complaint categories"
          placeholder="e.g. Roll length short"
          blurb="What a complaint can be filed under. A coordinator can also type a new one mid-call — it is saved here automatically and offered to everyone from the next call onward."
        />
        <ManagedList
          category="CRM_DEPT"
          title="Departments"
          placeholder="e.g. Quality control"
          blurb="Who a complaint is assigned to fix. Shown as “Whose to fix” on the call panel and on the issues board."
        />
        <ManagedList
          category="CRM_DELAY_REASON"
          title="Delay reasons"
          placeholder="e.g. Festival holiday"
          blurb="Offered when a customer says the order did not arrive on time."
        />
      </div>
    </div>
  );
}
