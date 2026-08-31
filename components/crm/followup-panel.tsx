"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  PhoneOffIcon,
  RotateCcwIcon,
  CheckIcon,
  PackageIcon,
  PlusIcon,
  TruckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  categoryLabel,
  CHANNEL_LABEL,
  CHANNEL_OUTCOMES,
  DELAY_REASON_LABEL,
  DELAY_REASONS,
  ISSUE_SEVERITIES,
  OUTCOME_LABEL,
  OWNER_DEPTS,
  overallRatingExact,
  deriveOverallRating,
  isReachedOutcome,
  STATUS_LABEL,
  type AttemptChannel,
  type AttemptOutcome,
  type DelayReason,
  type FollowupStatus,
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
import { Autocomplete } from "@/components/ui/autocomplete";
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
  /** Per-stage SLA outcome, so the panel can show numbers instead of a verdict. */
  sla: {
    stageKey: string;
    label: string;
    targetDays: number;
    lateMinutes: number;
    plannedAt: string | null;
    actualAt: string | null;
    done: number;
    total: number;
  }[];
  /** Scores by criterion key (§12.4) — criteria are configurable rows now. */
  ratings: Record<string, number>;
  criteria: {
    key: string;
    label: string;
    hint: string | null;
    sortOrder: number;
    isActive: boolean;
  }[];
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
    /** Who made the contact — differs from createdBy, who merely keyed it in. */
    attendedBy: string | null;
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
  muted,
  children,
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  /** Rendered read-only — the step does not apply in the current state. */
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-b border-line px-5 py-4 last:border-b-0",
        // A blocked section stays READABLE — greying it to nothing would hide
        // what was already recorded. It simply stops accepting input.
        muted && "pointer-events-none opacity-45 select-none",
      )}
    >
      <h3 className="mb-3 flex items-center gap-2.5 text-[11.5px] font-semibold tracking-[0.1em] text-ink uppercase">
        <span className="grid size-[18px] shrink-0 place-items-center rounded-md bg-accent/10 text-[11px] font-bold tracking-normal text-accent">
          {n}
        </span>
        <span className="text-ink">{title}</span>
        {aside ? (
          <span className="ml-auto text-[11.5px] font-medium tracking-normal text-ink-soft normal-case">
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
      <div className="text-[11px] font-semibold tracking-[0.07em] text-ink-soft uppercase">
        {k}
      </div>
      {/* Deliberately plain ink: these are context, and colouring them would
          compete with the status information below. */}
      <div className="mt-0.5 text-[13.5px] leading-snug font-semibold text-ink">{v}</div>
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
        "flex items-start gap-2.5 rounded-field border-l-[3px] px-3 py-2.5 text-[12.5px] leading-relaxed",
        tone === "bad" && "border-l-danger bg-danger/8 text-danger",
        tone === "ok" && "border-l-success bg-success/8 text-success",
        tone === "plain" && "border-l-line-strong bg-surface-2 text-ink-soft",
      )}
    >
      <span className="mt-[1px] shrink-0 [&_svg]:size-3.5">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="text-[11.5px] font-semibold tracking-[0.05em] text-ink uppercase">
          {label}
        </span>
        {hint ? <span className="text-[11px] text-ink-soft">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

const selectCls =
  "h-8 rounded-field border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

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
    /** Scores by criterion key — the criteria are configurable rows (§12.4). */
    ratings: Record<string, number>;
    overall: number | null;
    source: "customer" | "coordinator";
    reorder: ReorderIntent;
    reorderNote: string;
    contactPerson: string;
    contactPhone: string;
  } | null>(null);

  const d = q.data;
  // The draft exactly as it arrived, so "unsaved changes" is a fact rather
  // than a permanent warning. Saying "nothing is saved until you press Save"
  // on an untouched panel trains people to ignore the line that matters.
  const [pristine, setPristine] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!d) return;
    const f = d.followup;
    setDraft({
      customerSaysOnTime: f.customerSaysOnTime,
      delayReason: (f.delayReason as DelayReason | null) ?? null,
      ratings: { ...d.ratings },
      overall: f.ratingOverall,
      source: (f.ratingSource as "customer" | "coordinator") ?? "coordinator",
      reorder: (f.reorderIntent as ReorderIntent) ?? "none",
      reorderNote: f.reorderNote ?? "",
      contactPerson: f.contactPerson ?? "",
      contactPhone: f.contactPhone ?? "",
    });
    setPristine(
      JSON.stringify({
        ratings: { ...d.ratings },
        overall: f.ratingOverall,
        source: f.ratingSource ?? "coordinator",
        onTime: f.customerSaysOnTime,
        delayReason: f.delayReason,
        reorder: f.reorderIntent ?? "none",
        reorderNote: f.reorderNote ?? "",
        contactPerson: f.contactPerson ?? "",
        contactPhone: f.contactPhone ?? "",
      }),
    );
  }, [d]);

  const set = <K extends keyof NonNullable<typeof draft>>(
    k: K,
    v: NonNullable<typeof draft>[K],
  ) => setDraft((p) => (p ? { ...p, [k]: v } : p));

  // The overall follows the sub-ratings until the coordinator overrides it.
  const subs = draft?.ratings ?? {};
  const suggested = deriveOverallRating(subs);
  const exact = overallRatingExact(subs);
  // Keyed on the scores themselves, not on four named fields — the criteria
  // are configurable, so there is no fixed dependency list to write.
  const subsKey = JSON.stringify(subs);
  React.useEffect(() => {
    setDraft((p) => (p ? { ...p, overall: suggested } : p));
    // Only when a SUB-rating changes — otherwise this would fight a manual
    // override the moment it was set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsKey]);

  const [channel, setChannel] = React.useState<AttemptChannel>("call");
  const [outcome, setOutcome] = React.useState<AttemptOutcome>("connected");
  const [attendedBy, setAttendedBy] = React.useState("");

  // Switching channel must not leave an outcome that channel cannot have —
  // "Busy" surviving a switch to Visit would be submitted and rejected by the
  // API, which is a worse way to learn the rule than never seeing it.
  React.useEffect(() => {
    if (!CHANNEL_OUTCOMES[channel].includes(outcome)) {
      setOutcome(CHANNEL_OUTCOMES[channel][0]);
    }
  }, [channel, outcome]);

  // Suggestions for "visited by": the people already named as sales persons,
  // since that is who actually goes. Free text, so anyone else can be typed.
  const salesPeopleQ = useQuery({
    queryKey: ["lookups", "SALES_PERSON"],
    queryFn: () => apiGet<string[]>("/api/lookups?category=SALES_PERSON"),
  });
  const salesPeople = React.useMemo(
    () => (salesPeopleQ.data ?? []).filter((v): v is string => !!v),
    [salesPeopleQ.data],
  );

  // Marking unreachable with nothing logged writes the attempt first, so
  // coverage still counts the try. Without this the silence would be
  // unmeasurable, which is the whole reason attempts are logged (§12.7).
  const giveUp = async () => {
    if (!attempted) {
      const outcome = channel === "visit" ? "not_available" : "no_answer";
      await apiSend(`/api/crm/followups/${followupId}/attempts`, "POST", {
        channel,
        outcome,
        attended_by: null,
        note: "Marked unreachable without a separate attempt being logged",
      }).catch(() => null);
    }
    save.mutate("UNREACHABLE");
  };

  const attemptBlocked =
    channel === "visit" && outcome !== "not_available" && !attendedBy.trim()
      ? "Record who made the visit"
      : null;

  const logAttempt = useMutation({
    mutationFn: () =>
      apiSend(`/api/crm/followups/${followupId}/attempts`, "POST", {
        channel,
        outcome,
        attended_by: attendedBy.trim() || null,
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
        ratings: draft?.ratings ?? {},
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

  const current = draft
    ? JSON.stringify({
        ratings: draft.ratings,
        overall: draft.overall,
        source: draft.source,
        onTime: draft.customerSaysOnTime,
        delayReason: draft.delayReason,
        reorder: draft.reorder,
        reorderNote: draft.reorderNote,
        contactPerson: draft.contactPerson,
        contactPhone: draft.contactPhone,
      })
    : null;
  const dirty = pristine !== null && current !== null && pristine !== current;

  // UNREACHABLE means "we tried and could not get them" (§12.7). Two things
  // make it wrong to offer:
  //   * somebody HAS answered — the customer is, demonstrably, reachable;
  //   * nothing has been tried yet — there is no silence to record.
  // It used to sit next to Save unconditionally, so a coordinator could log a
  // connected call and then mark the same follow-up unreachable.
  // UNREACHABLE is a terminal-ish state: there was no conversation, so there
  // is nothing to answer, rate or promise. Everything after "Log attempt" is
  // blocked while it holds, and the way out is Reopen — not quietly filling in
  // a call that never happened.
  const isUnreachable = d?.followup.status === "UNREACHABLE";
  const connected = (d?.attempts ?? []).some((a) => isReachedOutcome(a.outcome));
  const attempted = (d?.attempts ?? []).length > 0;
  // The ONLY state in which giving up is wrong is one where somebody already
  // answered. Requiring a logged attempt first made the button permanently
  // disabled on a fresh follow-up — a control that is never available is not a
  // control, it is a puzzle. If nothing is logged yet, pressing it records the
  // failed attempt AND gives up, because a coordinator saying "I cannot reach
  // them" IS telling us they tried.
  const unreachableReason = connected
    ? "Someone answered on this order — it cannot be unreachable."
    : null;
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
      // The two facts worth carrying in the chrome: where this follow-up
      // stands, and what the order is worth — the second is why a coordinator
      // decides how hard to chase it.
      headerAside={
        d ? (
          <>
            <span className="num hidden text-[13px] font-semibold text-accent-deep sm:block">
              {`₹${formatNumber(row.orderValue)}`}
            </span>
            <Pill
              tone={
                d.followup.status === "COMPLETED"
                  ? "done"
                  : d.followup.status === "UNREACHABLE"
                    ? "warn"
                    : d.followup.status === "IN_PROGRESS"
                      ? "progress"
                      : "due"
              }
            >
              {STATUS_LABEL[d.followup.status as FollowupStatus] ??
                d.followup.status}
            </Pill>
          </>
        ) : null
      }
      onClose={onClose}
      footer={
        <>
          <span className="text-[12px] text-ink-soft">
            {d?.followup.isEscalated ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
                <AlertTriangleIcon className="size-3.5" />
                Flagged for principal review
              </span>
            ) : dirty ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                Unsaved changes
              </span>
            ) : (
              "Attempts and issues save immediately; the rest needs Save"
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="lg"
              disabled={!canEdit || busy}
              onClick={() => save.mutate(undefined)}
            >
              Save
            </Button>
            <Button
              size="lg"
              disabled={!canEdit || busy || !draft?.overall || isUnreachable}
              title={
                isUnreachable
                  ? "Reopen the follow-up first — there was no call to complete"
                  : draft?.overall
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
        <div className="px-4 py-10 text-center text-[13px] text-ink-soft">
          Loading…
        </div>
      ) : (
        // Two columns once there is room. Left is what the coordinator READS
        // before and during the call; right is what they FILL IN. Stacked
        // single-column below lg, which is what a phone gets.
        <div className="grid items-start lg:grid-cols-2 lg:divide-x lg:divide-line">
          <div className="min-w-0">
          <Section n={1} title="Context">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
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
                    <span className="ml-1 text-[12px] font-normal text-ink-soft">
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
                    {row.qualities} {row.qualities === 1 ? "quality" : "qualities"} ·{" "}
                    {row.designs} design{row.designs === 1 ? "" : "s"} —{" "}
                    <span className="num">{formatNumber(row.qtyMtr)} m</span>
                  </span>
                }
              />
            </div>
          </Section>

          <Section n={2} title="What we already know">
            <div className="flex flex-col gap-1.5">
              {(() => {
                // Written for a coordinator on a phone call, not for a
                // developer. The previous version read "Order Entry ran 60.3
                // days late against a 8-day target (7 stages missed: Order
                // Entry +60.3d…)" — every fact in it was true and none of it
                // was usable. What a caller needs is: what we promised, what
                // happened, how far apart they are, and whether to trust it.
                const rows = d.sla ?? [];
                const late = rows
                  .filter((r) => r.lateMinutes > 0)
                  .sort((a, b) => b.lateMinutes - a.lateMinutes);
                const days = (m: number) => Math.max(1, Math.round(m / 1440));
                const started = rows.filter((r) => r.done > 0);
                const dispatch = rows.find((r) => r.stageKey === "dispatch");

                if (started.length === 0) {
                  return (
                    <Know tone="plain" icon={<PackageIcon />}>
                      <b className="text-ink">Nothing has been ticked yet</b> on
                      this order, so we cannot say whether it was on time.
                    </Know>
                  );
                }

                if (late.length === 0) {
                  return (
                    <Know tone="ok" icon={<CheckIcon />}>
                      <b>Every step was finished on time.</b>
                      {dispatch ? (
                        <>
                          {" "}
                          Our plan allows{" "}
                          <b>{dispatch.targetDays} days</b> from the order date
                          to dispatch, and we stayed inside it.
                        </>
                      ) : null}
                    </Know>
                  );
                }

                const worst = late[0];
                const lateDays = days(worst.lateMinutes);
                const took = worst.targetDays + lateDays;
                return (
                  <Know tone="bad" icon={<AlertTriangleIcon />}>
                    <b className="text-[13px]">This order was late.</b>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      <li className="flex gap-2">
                        <span className="w-[86px] shrink-0 text-ink-soft">
                          We planned
                        </span>
                        <span>
                          <b>{worst.label}</b> within{" "}
                          <b className="num">{worst.targetDays} days</b> of the
                          order date
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="w-[86px] shrink-0 text-ink-soft">
                          It took
                        </span>
                        <span>
                          about <b className="num">{took} days</b>
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="w-[86px] shrink-0 text-ink-soft">
                          So we were
                        </span>
                        <span>
                          <b className="num">{lateDays} days</b> later than
                          planned
                        </span>
                      </li>
                      <li className="flex gap-2">
                        <span className="w-[86px] shrink-0 text-ink-soft">
                          Steps late
                        </span>
                        <span>
                          <b className="num">{late.length}</b> of{" "}
                          <b className="num">{rows.length}</b>
                          {late.length > 1 ? (
                            <span className="text-ink-soft">
                              {" "}
                              — {late.slice(0, 3).map((r) => r.label).join(", ")}
                              {late.length > 3 ? " and more" : ""}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    </ul>
                    <p className="mt-2.5 border-t border-danger/20 pt-2 text-[12px] leading-relaxed text-ink-soft">
                      This is against <b>our own plan</b>. The customer may still
                      feel it arrived on time — ask them, do not assume.
                    </p>
                  </Know>
                );
              })()}
              {row.hadOutOfStock ? (
                <Know tone="plain" icon={<PackageIcon />}>
                  <b>We ran out of stock</b> on one of the designs, which is
                  part of why this took longer.
                </Know>
              ) : null}
              {row.hadCancellation ? (
                <Know tone="plain" icon={<TruckIcon />}>
                  <b>Some designs on this order were cancelled.</b> They may
                  bring it up — have the reason ready.
                </Know>
              ) : null}
            </div>
          </Section>

          <Section n={3} title="Log attempt" aside={`${d.attempts.length} logged`}>
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface-2 p-2">
              <Segmented
                size="sm"
                ariaLabel="Channel"
                value={channel}
                onChange={setChannel}
                options={(["call", "whatsapp", "visit"] as AttemptChannel[]).map(
                  (c) => ({ value: c, label: CHANNEL_LABEL[c] }),
                )}
              />
              {/* Outcomes follow the channel: a visit is never "busy" and a
                  WhatsApp is never "met at our office". Offering all of them
                  everywhere is how a form tells people it was not built for
                  their job. The API enforces the same pairing. */}
              <select
                className={selectCls}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as AttemptOutcome)}
              >
                {CHANNEL_OUTCOMES[channel].map((v) => (
                  <option key={v} value={v}>
                    {OUTCOME_LABEL[v]}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={!canEdit || busy || attemptBlocked !== null}
                title={attemptBlocked ?? "Log this attempt"}
                onClick={() => logAttempt.mutate()}
              >
                <PlusIcon /> Log
              </Button>

            </div>

            {/* A visit was made by somebody, and "who went?" is the first
                question asked about it later. The coordinator recording it is
                usually not the person who went. */}
            {channel === "visit" && outcome !== "not_available" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-[12px] text-ink-soft">Visited by</label>
                <Autocomplete
                  value={attendedBy}
                  onValueChange={setAttendedBy}
                  suggestions={salesPeople}
                  placeholder="Who made the visit?"
                  className="h-9 min-w-[200px] flex-1"
                />
              </div>
            ) : null}
            {d.attempts.length > 0 ? (
              <ul className="mt-2.5 flex flex-col gap-1">
                {d.attempts.slice(0, 3).map((a, i) => (
                  <li key={a.id} className="text-[12px] text-ink-soft">
                    Attempt {d.attempts.length - i} ·{" "}
                    <span className="num">{formatDateTime(a.attemptedAt)}</span> —{" "}
                    {OUTCOME_LABEL[a.outcome as AttemptOutcome] ?? a.outcome}
                    {a.attendedBy ? ` · by ${a.attendedBy}` : ""}
                    {a.createdBy ? ` · logged by ${a.createdBy}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-[12px] text-ink-soft">
                No attempt logged yet. Log the unanswered ones too — coverage is
                unmeasurable without them.
              </p>
            )}

            {/* Giving up belongs HERE, under the attempts that justify it —
                not in the footer beside Save and Complete, where it read as a
                third way to finish a call that was never had. It is the
                CONCLUSION drawn from the log, so it sits below it. */}
            {!isUnreachable ? (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
                <span className="text-[12px] text-ink-soft">
                  {unreachableReason ??
                    (attempted
                      ? "Tried enough times?"
                      : "Tried and got nowhere? This logs the attempt too.")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-warning hover:bg-warning/10"
                  disabled={!canEdit || busy || unreachableReason !== null}
                  title={
                    unreachableReason ??
                    (attempted
                      ? "Give up on this one — no answer after repeated attempts"
                      : "Records a failed attempt and gives up on this one")
                  }
                  onClick={giveUp}
                >
                  <PhoneOffIcon /> Can&rsquo;t reach
                </Button>
              </div>
            ) : null}
          </Section>
          </div>

          <div className="min-w-0 border-t border-line lg:border-t-0">
          {isUnreachable ? (
            <div className="border-b border-line bg-warning/8 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <PhoneOffIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">
                    Marked unreachable
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
                    No conversation happened, so there is nothing to answer,
                    rate or promise — the steps below are closed. Anything
                    already recorded is kept. Reopen if they call back.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2.5"
                    disabled={!canEdit || busy}
                    onClick={() => save.mutate("IN_PROGRESS")}
                  >
                    <RotateCcwIcon /> Reopen follow-up
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <Section n={4} title="The call" muted={isUnreachable}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 rounded-field bg-surface-2 px-3 py-2.5">
                <span className="text-[12.5px] font-medium text-ink">
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
                <div className="flex items-center justify-between gap-3 rounded-field bg-surface-2 px-3 py-2.5">
                  <span className="text-[12.5px] font-medium text-ink">
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

          <Section
            n={5}
            title="Ratings"
            aside="press 1–5 with a row focused"
            muted={isUnreachable}
          >
            {d.criteria.length === 0 ? (
              <p className="py-2 text-[12.5px] text-ink-soft">
                No rating criteria are configured. An admin can add them in
                Settings → CRM.
              </p>
            ) : (
              d.criteria.map((c) => (
                <div
                  key={c.key}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-field px-2 py-2 transition-colors not-last:border-b not-last:border-line/60 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-ink">
                      {c.label}
                    </span>
                    {c.hint ? (
                      <span className="ml-1.5 text-[11px] text-ink-soft">
                        {c.hint}
                      </span>
                    ) : null}
                    {/* A retired criterion only appears when this call already
                        scored it, so the old score stays readable. */}
                    {!c.isActive ? (
                      <span className="ml-1.5 text-[11px] text-ink-soft italic">
                        retired
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "num w-3 text-right text-[12.5px] font-semibold tabular-nums",
                        draft.ratings[c.key] ? "text-ink" : "text-transparent",
                      )}
                    >
                      {draft.ratings[c.key] ?? 0}
                    </span>
                  <StarPicker
                    label={c.label}
                    size={17}
                    value={draft.ratings[c.key] ?? null}
                    onChange={(v) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              ratings: (() => {
                                const next = { ...prev.ratings };
                                if (v === null) delete next[c.key];
                                else next[c.key] = v;
                                return next;
                              })(),
                            }
                          : prev,
                      )
                    }
                  />
                  </div>
                </div>
              ))
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-card border border-line bg-inset px-3.5 py-3">
              <div>
                <div className="text-[11px] font-medium tracking-[0.07em] text-ink-soft uppercase">
                  Overall &middot; suggested, editable
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <StarPicker
                    label="Overall"
                    size={19}
                    value={draft.overall}
                    onChange={(v) => set("overall", v)}
                  />
                  <span className="num text-[22px] leading-none font-semibold tracking-[-0.02em] text-ink">
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

          <Section n={6} title="Next requirement" muted={isUnreachable}>
            {/* The commercial half of the call. A post-delivery conversation
                reaches a customer at their warmest all quarter, so this is not
                an afterthought — it is the line that pays for the call. */}
            <p className="mb-2 text-[12.5px] text-ink-soft">
              Are they buying again?
            </p>
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
                <p className="mt-1.5 text-[12px] text-ink-soft">
                  Goes to the sales reorder list
                  {d.order.salesPerson ? `, tagged to ${d.order.salesPerson}` : ""}.
                </p>
              </>
            ) : null}
          </Section>
          </div>
        </div>
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
  // A DROPDOWN, with "Other" as the escape hatch — not a free-text box.
  // Free text was tried and was wrong: the field looked like a plain input, so
  // the categories already on file were invisible and every coordinator would
  // have coined their own wording for the same complaint. Picking is the
  // common case; typing is the exception, and it must look like one.
  const OTHER = "__other__";
  const [category, setCategory] = React.useState<IssueCategory>("");
  const [otherCategory, setOtherCategory] = React.useState("");

  // Complaint categories are managed data (Settings → CRM), not a fixed enum:
  // a customer complains about whatever they complain about. The list is
  // fetched here and a genuinely new value typed on the call is added to the
  // master by the issues API, so it is offered on the very next call.
  const categoryList = useQuery({
    queryKey: ["lookups", "CRM_ISSUE"],
    // NOTE: without ?all=1 this endpoint returns a plain string[], not row
    // objects. Typing it as {value}[] produced an array of undefined and took
    // the whole panel down on mount.
    queryFn: () => apiGet<string[]>("/api/lookups?category=CRM_ISSUE"),
  });
  const categories = React.useMemo(
    () => (categoryList.data ?? []).filter((v): v is string => !!v),
    [categoryList.data],
  );
  React.useEffect(() => {
    if (!category && categories.length) setCategory(categories[0]);
  }, [categories, category]);
  const [severity, setSeverity] = React.useState<IssueSeverity>("MEDIUM");
  const [dept, setDept] = React.useState<OwnerDept>("TRANSPORT");
  const [qty, setQty] = React.useState("");
  const [desc, setDesc] = React.useState("");

  // "Other" is a UI affordance, never a stored value — what lands in the
  // database is the words the coordinator actually typed.
  const chosenCategory = category === OTHER ? otherCategory.trim() : category;

  const create = useMutation({
    mutationFn: () =>
      apiSend("/api/crm/issues", "POST", {
        followup_id: followupId,
        order_line_item_id: lineId || null,
        category: chosenCategory,
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
      setOtherCategory("");
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
              {categoryLabel(i.category)}
            </strong>
            <span className="ml-auto text-[12px] text-ink-soft">Issue #{n + 1}</span>
          </div>
          <div className="text-[12px] text-ink-soft">
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
            <p className="mt-1 text-[12.5px] text-ink">{i.description}</p>
          ) : null}
        </div>
      ))}

      {adding ? (
        <div className="rounded-card border border-line bg-surface-2 p-3">
          <div className="mb-2.5 text-[12px] font-semibold tracking-[0.06em] text-ink-soft uppercase">
            New issue
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="What went wrong">
              <select
                className={cn(selectCls, "w-full")}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
                {/* The escape hatch. Anything typed under it is added to the
                    master list by the issues API, so the next coordinator picks
                    it instead of inventing a second wording for the same
                    complaint. */}
                <option value={OTHER}>Other — type it in…</option>
              </select>
            </Field>

            <Field label="Which design">
              <select
                className={cn(selectCls, "w-full")}
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
            </Field>

            {category === OTHER ? (
              <Field
                label="Name the problem"
                hint="Saved to the list for everyone"
                wide
              >
                <Input
                  autoFocus
                  className="h-8 w-full text-[12.5px]"
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                  placeholder="e.g. Roll length short"
                />
              </Field>
            ) : null}

            <Field label="Severity">
              <select
                className={cn(selectCls, "w-full")}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
              >
                {ISSUE_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s === "HIGH" ? "High" : s === "MEDIUM" ? "Medium" : "Low"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Whose to fix">
              <select
                className={cn(selectCls, "w-full")}
                value={dept}
                onChange={(e) => setDept(e.target.value as OwnerDept)}
              >
                {OWNER_DEPTS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Meters affected" hint="optional">
              <Input
                className="h-8 w-full text-[12.5px]"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 120"
                inputMode="decimal"
              />
            </Field>

            <Field label="What exactly happened" hint="optional" wide>
              <Input
                className="h-8 w-full text-[12.5px]"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Two thans water-stained at the edges…"
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setOtherCategory("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={create.isPending || !chosenCategory}
              title={
                chosenCategory ? "Raise this issue" : "Name the problem first"
              }
              onClick={() => create.mutate()}
            >
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
