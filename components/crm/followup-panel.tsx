"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckIcon,
  PackageIcon,
  PlusIcon,
  TruckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  CATEGORY_LABEL,
  CHANNEL_LABEL,
  DELAY_REASON_LABEL,
  DELAY_REASONS,
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  OUTCOME_LABEL,
  OWNER_DEPTS,
  overallRatingExact,
  deriveOverallRating,
  type AttemptChannel,
  type AttemptOutcome,
  type DelayReason,
  type IssueCategory,
  type IssueSeverity,
  type OwnerDept,
  type FollowupRow,
  type ReorderIntent,
} from "@/lib/crm";
import { formatDate, formatDateTime, formatNumber } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DraggablePanel } from "@/components/ui/draggable-panel";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StarPicker } from "@/components/ui/star-rating";
import { Pill } from "@/components/crm/crm-pill";

// The call panel (CLAUDE.md §12, OE-P16). A floating window, not a drawer, so
// the queue stays visible and reachable while a call is worked.

type Detail = {
  followup: Record<string, unknown> & {
    id: string;
    status: string;
    customerSaysOnTime: boolean | null;
    delayReason: string | null;
    ratingDelivery: number | null;
    ratingQuality: number | null;
    ratingPacking: number | null;
    ratingCoordination: number | null;
    ratingOverall: number | null;
    ratingSource: string | null;
    reorderIntent: string;
    reorderNote: string | null;
    contactPerson: string | null;
    contactPhone: string | null;
    systemOnTime: boolean | null;
    deliveryBasis: string | null;
    deliveredAt: string | null;
    attemptCount: number;
    isEscalated: boolean;
  };
  order: {
    orderNo: string;
    orderDate: string;
    partyName: string;
    salesPerson: string | null;
    agent: string | null;
    transport: string | null;
  };
  lines: {
    id: string;
    quality: string;
    designNo: string;
    qtyMtr: string;
    isCancelled: boolean;
  }[];
  attempts: {
    id: string;
    channel: string;
    outcome: string;
    note: string | null;
    attemptedAt: string;
    createdBy: string | null;
  }[];
  issues: {
    id: string;
    category: string;
    severity: string;
    ownerDept: string | null;
    quality: string | null;
    designNo: string | null;
    qtyAffected: string | null;
    description: string | null;
    status: string;
  }[];
};

function Section({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <h3 className="mb-2.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.09em] text-ink-muted uppercase">
        <span className="grid size-4 place-items-center rounded-[5px] bg-inset text-[9.5px] tracking-normal text-ink-soft">
          {n}
        </span>
        {title}
        {aside ? (
          <span className="ml-auto text-[10px] font-medium tracking-normal normal-case">
            {aside}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function Fact({ k, v, wide }: { k: string; v: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn(wide && "col-span-2")}>
      <div className="text-[10.5px] tracking-[0.05em] text-ink-muted uppercase">{k}</div>
      {/* Deliberately plain ink: these are context, and colouring them would
          compete with the status information below. */}
      <div className="text-[13px] font-medium text-ink">{v}</div>
    </div>
  );
}

function Know({
  tone,
  icon,
  children,
}: {
  tone: "bad" | "ok" | "plain";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-field px-2.5 py-2 text-[12.5px]",
        tone === "bad" && "bg-danger/10 text-danger",
        tone === "ok" && "bg-success/10 text-success",
        tone === "plain" && "border border-line bg-surface-2 text-ink-soft",
      )}
    >
      <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

const selectCls =
  "h-8 rounded-field border border-line bg-surface px-2 text-[12px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

export function FollowupPanel({
  followupId,
  row,
  canEdit,
  onClose,
  onSaved,
}: {
  followupId: string;
  row: FollowupRow;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const q = useQuery({
    queryKey: ["crm-followup", followupId],
    queryFn: () => apiGet<Detail>(`/api/crm/followups/${followupId}`),
  });

  // Local draft. The panel is a form over a slow conversation, so nothing is
  // written until the coordinator saves — except attempts and issues, which are
  // events and are posted the moment they happen.
  const [draft, setDraft] = React.useState<{
    customerSaysOnTime: boolean | null;
    delayReason: DelayReason | null;
    delivery: number | null;
    quality: number | null;
    packing: number | null;
    coordination: number | null;
    overall: number | null;
    source: "customer" | "coordinator";
    reorder: ReorderIntent;
    reorderNote: string;
    contactPerson: string;
    contactPhone: string;
  } | null>(null);

  const d = q.data;
  React.useEffect(() => {
    if (!d) return;
    const f = d.followup;
    setDraft({
      customerSaysOnTime: f.customerSaysOnTime,
      delayReason: (f.delayReason as DelayReason | null) ?? null,
      delivery: f.ratingDelivery,
      quality: f.ratingQuality,
      packing: f.ratingPacking,
      coordination: f.ratingCoordination,
      overall: f.ratingOverall,
      source: (f.ratingSource as "customer" | "coordinator") ?? "coordinator",
      reorder: (f.reorderIntent as ReorderIntent) ?? "none",
      reorderNote: f.reorderNote ?? "",
      contactPerson: f.contactPerson ?? "",
      contactPhone: f.contactPhone ?? "",
    });
  }, [d]);

  const set = <K extends keyof NonNullable<typeof draft>>(
    k: K,
    v: NonNullable<typeof draft>[K],
  ) => setDraft((p) => (p ? { ...p, [k]: v } : p));

  // The overall follows the four sub-ratings until the coordinator overrides it.
  const subs = draft
    ? {
        delivery: draft.delivery,
        quality: draft.quality,
        packing: draft.packing,
        coordination: draft.coordination,
      }
    : { delivery: null, quality: null, packing: null, coordination: null };
  const suggested = deriveOverallRating(subs);
  const exact = overallRatingExact(subs);
  React.useEffect(() => {
    setDraft((p) => (p ? { ...p, overall: suggested } : p));
    // Only when a SUB-rating changes — otherwise this would fight a manual
    // override the moment it was set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.delivery, draft?.quality, draft?.packing, draft?.coordination]);

  const [channel, setChannel] = React.useState<AttemptChannel>("call");
  const [outcome, setOutcome] = React.useState<AttemptOutcome>("connected");

  const logAttempt = useMutation({
    mutationFn: () =>
      apiSend(`/api/crm/followups/${followupId}/attempts`, "POST", {
        channel,
        outcome,
        note: null,
      }),
    onSuccess: () => {
      toast.success("Attempt logged");
      q.refetch();
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: (status?: string) =>
      apiSend(`/api/crm/followups/${followupId}`, "PATCH", {
        status,
        customer_says_on_time: draft?.customerSaysOnTime,
        delay_reason: draft?.delayReason,
        rating_delivery: draft?.delivery,
        rating_quality: draft?.quality,
        rating_packing: draft?.packing,
        rating_coordination: draft?.coordination,
        rating_overall: draft?.overall,
        rating_source: draft?.source,
        reorder_intent: draft?.reorder,
        reorder_note: draft?.reorderNote || null,
        contact_person: draft?.contactPerson || null,
        contact_phone: draft?.contactPhone || null,
      }),
    onSuccess: () => {
      toast.success("Follow-up saved");
      q.refetch();
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = save.isPending || logAttempt.isPending;
  const highIssue = (d?.issues ?? []).some((i) => i.severity === "HIGH");

  return (
    <DraggablePanel
      tinted
      title={`${row.orderNo} · ${row.partyName}`}
      subtitle={
        d
          ? `Attempt ${d.followup.attemptCount} · ${row.daysWaiting} days since delivery`
          : "Loading…"
      }
      onClose={onClose}
      footer={
        <>
          <span className="text-[11.5px] text-ink-muted">
            {d?.followup.isEscalated ? (
              <span className="font-semibold text-danger">
                Flagged for principal review
              </span>
            ) : (
              "Nothing is saved until you press Save"
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              disabled={!canEdit || busy}
              onClick={() => save.mutate("UNREACHABLE")}
            >
              Unreachable
            </Button>
            <Button
              size="lg"
              disabled={!canEdit || busy}
              onClick={() => save.mutate(undefined)}
            >
              Save
            </Button>
            <Button
              size="lg"
              disabled={!canEdit || busy || !draft?.overall}
              title={
                draft?.overall
                  ? "Complete this follow-up"
                  : "An overall rating is required to complete"
              }
              onClick={() => save.mutate("COMPLETED")}
            >
              Complete
            </Button>
          </div>
        </>
      }
    >
      {!d || !draft ? (
        <div className="px-4 py-10 text-center text-[13px] text-ink-muted">
          Loading…
        </div>
      ) : (
        <>
          <Section n={1} title="Context">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Fact k="Order no" v={<span className="num">{d.order.orderNo}</span>} />
              <Fact
                k="Order value"
                v={
                  <span className="num">
                    {row.orderValue > 0 ? `₹${formatNumber(row.orderValue)}` : "—"}
                  </span>
                }
              />
              <Fact k="OD date" v={<span className="num">{formatDate(d.order.orderDate)}</span>} />
              <Fact
                k="Delivered on"
                v={
                  <span className="num">
                    {formatDate(d.followup.deliveredAt)}
                    <span className="ml-1 text-[11px] font-normal text-ink-muted">
                      {d.followup.deliveryBasis === "received_lr"
                        ? "· LR received"
                        : "· dispatch + transit"}
                    </span>
                  </span>
                }
              />
              <Fact k="Sales person" v={d.order.salesPerson || "—"} />
              <Fact k="Transport" v={d.order.transport || "—"} />
              <Fact
                wide
                k="Qualities · designs"
                v={
                  <span>
                    {row.qualities} quality{row.qualities === 1 ? "" : "s"} ·{" "}
                    {row.designs} design{row.designs === 1 ? "" : "s"} —{" "}
                    <span className="num">{formatNumber(row.qtyMtr)} m</span>
                  </span>
                }
              />
            </div>
          </Section>

          <Section n={2} title="What we already know">
            <div className="flex flex-col gap-1.5">
              {d.followup.systemOnTime === false ? (
                <Know tone="bad" icon={<AlertTriangleIcon />}>
                  Our SLA says this ran <strong>late</strong> — note this is
                  measured against the configured deadline, not transit reality.
                </Know>
              ) : (
                <Know tone="ok" icon={<CheckIcon />}>
                  Our SLA says every stage was inside its deadline.
                </Know>
              )}
              {row.hadOutOfStock ? (
                <Know tone="plain" icon={<PackageIcon />}>
                  A design was <strong>out of stock</strong> at stock checking.
                </Know>
              ) : null}
              {row.hadCancellation ? (
                <Know tone="plain" icon={<TruckIcon />}>
                  This order has <strong>cancelled designs</strong> — expect it to
                  come up.
                </Know>
              ) : null}
            </div>
          </Section>

          <Section n={3} title="Log attempt" aside={`${d.attempts.length} logged`}>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                size="sm"
                ariaLabel="Channel"
                value={channel}
                onChange={setChannel}
                options={(["call", "whatsapp", "visit"] as AttemptChannel[]).map(
                  (c) => ({ value: c, label: CHANNEL_LABEL[c] }),
                )}
              />
              <select
                className={selectCls}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as AttemptOutcome)}
              >
                {Object.entries(OUTCOME_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={!canEdit || busy}
                onClick={() => logAttempt.mutate()}
              >
                <PlusIcon /> Log
              </Button>
            </div>
            {d.attempts.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-1">
                {d.attempts.slice(0, 3).map((a, i) => (
                  <li key={a.id} className="text-[11.5px] text-ink-muted">
                    Attempt {d.attempts.length - i} ·{" "}
                    <span className="num">{formatDateTime(a.attemptedAt)}</span> —{" "}
                    {OUTCOME_LABEL[a.outcome as AttemptOutcome] ?? a.outcome}
                    {a.createdBy ? ` · ${a.createdBy}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-[11.5px] text-ink-muted">
                No attempt logged yet. Log the unanswered ones too — coverage is
                unmeasurable without them.
              </p>
            )}
          </Section>

          <Section n={4} title="The call">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] font-medium text-ink-soft">
                  Did it reach on time, from our side?
                </span>
                <Segmented
                  size="sm"
                  tone={draft.customerSaysOnTime === false ? "negative" : "positive"}
                  ariaLabel="Customer says on time"
                  value={
                    draft.customerSaysOnTime === null
                      ? null
                      : draft.customerSaysOnTime
                        ? "yes"
                        : "no"
                  }
                  onChange={(v) => set("customerSaysOnTime", v === "yes")}
                  options={[
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                  ]}
                />
              </div>

              {draft.customerSaysOnTime === false ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px] font-medium text-ink-soft">
                    Reason for the delay
                  </span>
                  <select
                    className={selectCls}
                    value={draft.delayReason ?? ""}
                    onChange={(e) =>
                      set("delayReason", (e.target.value || null) as DelayReason | null)
                    }
                  >
                    <option value="">Not stated</option>
                    {DELAY_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {DELAY_REASON_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <IssueList
              followupId={followupId}
              lines={d.lines}
              issues={d.issues}
              canEdit={canEdit}
              onChanged={() => {
                q.refetch();
                onSaved();
              }}
            />
          </Section>

          <Section n={5} title="Ratings" aside="press 1–5 with a row focused">
            {(
              [
                ["delivery", "Delivery", "timeliness, handling"],
                ["quality", "Quality", "fabric, print, shade"],
                ["packing", "Packing", "condition on arrival"],
                ["coordination", "Coordination", "our communication"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between py-[7px]">
                <div>
                  <span className="text-[12.5px] font-medium text-ink">{label}</span>
                  <span className="ml-1.5 text-[10px] text-ink-muted">{hint}</span>
                </div>
                <StarPicker
                  label={label}
                  value={draft[key]}
                  onChange={(v) => set(key, v)}
                />
              </div>
            ))}

            <div className="mt-2 flex items-center justify-between gap-3 rounded-field bg-inset px-3 py-2.5">
              <div>
                <div className="text-[11px] text-ink-muted">
                  Overall — suggested, editable
                </div>
                <div className="mt-0.5 flex items-center gap-2.5">
                  <StarPicker
                    label="Overall"
                    size={19}
                    value={draft.overall}
                    onChange={(v) => set("overall", v)}
                  />
                  <span className="num text-[13px] font-semibold text-ink">
                    {exact !== null ? exact.toFixed(1) : "—"}
                  </span>
                </div>
              </div>
              <Segmented
                size="sm"
                ariaLabel="Rating source"
                value={draft.source}
                onChange={(v) => set("source", v)}
                options={[
                  { value: "coordinator", label: "Coordinator judged" },
                  { value: "customer", label: "Customer stated" },
                ]}
              />
            </div>

            {(draft.overall !== null && draft.overall <= 2) || highIssue ? (
              <div className="mt-2.5">
                <Know tone="bad" icon={<AlertTriangleIcon />}>
                  {highIssue
                    ? "A high-severity issue is open"
                    : "Overall rating is 2 or below"}{" "}
                  — this will be <strong>flagged for principal review</strong>.
                </Know>
              </div>
            ) : null}
          </Section>

          <Section n={6} title="Next requirement">
            <Segmented
              size="sm"
              ariaLabel="Reorder intent"
              value={draft.reorder}
              onChange={(v) => set("reorder", v)}
              options={[
                { value: "none", label: "None" },
                { value: "maybe", label: "Maybe" },
                { value: "yes", label: "Yes" },
                { value: "sample_requested", label: "Sample" },
              ]}
            />
            {draft.reorder !== "none" ? (
              <>
                <Input
                  className="mt-2.5 h-9"
                  value={draft.reorderNote}
                  onChange={(e) => set("reorderNote", e.target.value)}
                  placeholder="What did they ask for?"
                />
                <p className="mt-1.5 text-[11.5px] text-ink-muted">
                  Goes to the sales reorder list
                  {d.order.salesPerson ? `, tagged to ${d.order.salesPerson}` : ""}.
                </p>
              </>
            ) : null}
          </Section>
        </>
      )}
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------

function IssueList({
  followupId,
  lines,
  issues,
  canEdit,
  onChanged,
}: {
  followupId: string;
  lines: Detail["lines"];
  issues: Detail["issues"];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [lineId, setLineId] = React.useState("");
  const [category, setCategory] = React.useState<IssueCategory>("DAMAGE_TRANSIT");
  const [severity, setSeverity] = React.useState<IssueSeverity>("MEDIUM");
  const [dept, setDept] = React.useState<OwnerDept>("TRANSPORT");
  const [qty, setQty] = React.useState("");
  const [desc, setDesc] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      apiSend("/api/crm/issues", "POST", {
        followup_id: followupId,
        order_line_item_id: lineId || null,
        category,
        severity,
        owner_dept: dept,
        qty_affected: qty ? Number(qty) : null,
        description: desc || null,
      }),
    onSuccess: () => {
      toast.success("Issue raised");
      setAdding(false);
      setQty("");
      setDesc("");
      setLineId("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3">
      {issues.map((i, n) => (
        <div
          key={i.id}
          className="mb-2 rounded-field border border-danger/40 bg-danger/5 p-2.5"
        >
          <div className="mb-1 flex items-center gap-2">
            <Pill tone={i.severity === "HIGH" ? "late" : "warn"}>
              {i.severity === "HIGH" ? "High" : i.severity === "MEDIUM" ? "Medium" : "Low"}
            </Pill>
            <strong className="text-[12.5px] text-ink">
              {CATEGORY_LABEL[i.category as IssueCategory] ?? i.category}
            </strong>
            <span className="ml-auto text-[11px] text-ink-muted">Issue #{n + 1}</span>
          </div>
          <div className="text-[11.5px] text-ink-soft">
            {i.quality ? (
              <>
                {i.quality} · <span className="num">{i.designNo}</span>
              </>
            ) : (
              "Whole order"
            )}
            {i.qtyAffected ? (
              <>
                {" "}
                — <span className="num">{formatNumber(Number(i.qtyAffected))} m</span>
              </>
            ) : null}
            {i.ownerDept ? ` · ${i.ownerDept}` : ""}
          </div>
          {i.description ? (
            <p className="mt-1 text-[12px] text-ink">{i.description}</p>
          ) : null}
        </div>
      ))}

      {adding ? (
        <div className="rounded-field border border-line bg-surface-2 p-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <select
              className={selectCls}
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
            >
              <option value="">Whole order (no design)</option>
              {lines
                .filter((l) => !l.isCancelled)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.quality} · {l.designNo}
                  </option>
                ))}
            </select>
            <select
              className={selectCls}
              value={category}
              onChange={(e) => setCategory(e.target.value as IssueCategory)}
            >
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={severity}
              onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
            >
              {ISSUE_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  Severity: {s}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={dept}
              onChange={(e) => setDept(e.target.value as OwnerDept)}
            >
              {OWNER_DEPTS.map((o) => (
                <option key={o} value={o}>
                  Owner: {o}
                </option>
              ))}
            </select>
            <Input
              className="h-8 text-[12px]"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Meters affected"
              inputMode="decimal"
            />
            <Input
              className="h-8 text-[12px]"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What exactly happened…"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
              Add issue
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setAdding(true)}
          className="w-full cursor-pointer rounded-field border border-dashed border-line-strong py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add {issues.length > 0 ? "another " : ""}issue
        </button>
      )}
    </div>
  );
}
