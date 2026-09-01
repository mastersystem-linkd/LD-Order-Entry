"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquareTextIcon,
  PhoneCallIcon,
  SearchIcon,
  ShoppingBagIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { CHANNEL_LABEL, STATUS_LABEL, type CallList, type CallRecord } from "@/lib/crm";
import { formatCount, formatDateTime, formatNumber } from "@/lib/orders";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Card, CardTitle } from "@/components/ui/card";
import { HScroll } from "@/components/ui/h-scroll";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { StatCard } from "@/components/ui/stat-card";
import { Stars } from "@/components/ui/star-rating";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { Pill } from "@/components/crm/crm-pill";

// CRM → Call log (CLAUDE.md §12.5.6). The record of what customers said.
//
// It exists because three things were WRITE-ONLY. Feedback, the per-criterion
// scores and the reorder note were all written by the call panel and readable
// nowhere else — a coordinator could record "they want 2,000 m satin crepe in
// September" and nobody, sales included, could find it again without opening
// that one order. Complaints had a board; the rest of the call had nothing.
//
// A log, not a queue: newest first, read-only, and it never shows a follow-up
// nobody has touched.

const selectCls =
  "h-9 rounded-field border border-line bg-surface px-2.5 text-[12.5px] font-medium text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

const INTENT_LABEL: Record<string, string> = {
  none: "—",
  maybe: "Maybe",
  yes: "Buying again",
  sample_requested: "Asked for a sample",
};

function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${formatNumber(n)}`;
}

export function CallsLog() {
  const [rawSearch, setRawSearch] = React.useState("");
  const [has, setHas] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const search = useDebouncedValue(rawSearch, 250);

  const params = new URLSearchParams();
  params.set("page", String(page));
  if (has) params.set("has", has);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (search) params.set("q", search);
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-calls", qs],
    queryFn: () => apiGet<CallList>(`/api/crm/calls?${qs}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    setPage(1);
  }, [has, from, to, search]);

  const data = q.data;
  const rows = data?.rows ?? [];
  const k = data?.kpis;

  const only = (v: string) => () => setHas(has === v ? "" : v);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
        <StatCard
          className="py-2 sm:py-3"
          icon={<PhoneCallIcon />}
          label="Calls worked"
          value={k ? formatCount(k.calls) : "—"}
          sub={has === "" ? "showing all" : "show all"}
          active={has === ""}
          onClick={() => setHas("")}
        />
        <StatCard
          className="py-2 sm:py-3"
          icon={<MessageSquareTextIcon />}
          label="With feedback"
          value={k ? formatCount(k.withFeedback) : "—"}
          tone="amber"
          sub={has === "feedback" ? "showing these" : "in their own words"}
          active={has === "feedback"}
          onClick={only("feedback")}
        />
        <StatCard
          className="py-2 sm:py-3"
          icon={<ShoppingBagIcon />}
          label="Reorder signals"
          value={k ? formatCount(k.reorderSignals) : "—"}
          tone="green"
          sub={has === "reorder" ? "showing these" : "wants something next"}
          active={has === "reorder"}
          onClick={only("reorder")}
        />
        <StatCard
          className="py-2 sm:py-3"
          icon={<TriangleAlertIcon />}
          label="Escalated"
          value={k ? formatCount(k.escalated) : "—"}
          tone="red"
          sub="flagged for review"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        <select
          className={selectCls}
          value={has}
          onChange={(e) => setHas(e.target.value)}
          aria-label="Show"
        >
          <option value="">Every worked call</option>
          <option value="feedback">Only with feedback</option>
          <option value="reorder">Only with a reorder signal</option>
          <option value="rating">Only rated</option>
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From"
            className={selectCls}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-[11.5px] text-ink-soft">to</span>
          <input
            type="date"
            aria-label="To"
            className={selectCls}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
          {from || to ? (
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="cursor-pointer rounded-field px-1.5 py-1 text-[11.5px] font-medium text-ink-soft hover:bg-inset hover:text-ink"
            >
              Clear
            </button>
          ) : null}
        </div>

        {/* Searching the feedback TEXT is the point — "who mentioned packing?"
            is the question this screen exists to answer. */}
        <div className="relative order-last w-full min-w-0 sm:order-none sm:w-auto sm:min-w-[220px] sm:flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Search order, party, or anything they said…"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 sm:px-5">
          <CardTitle className="text-[15px]">Call log</CardTitle>
          {data ? (
            <span className="num rounded-pill bg-inset px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft">
              {data.total}
            </span>
          ) : null}
          <span className="hidden text-[12px] text-ink-soft sm:inline">
            newest first · click a row for the whole call
          </span>
        </div>

        <HScroll>
          <Table>
            <THead>
              <tr>
                <Th>Order · party</Th>
                <Th>Called</Th>
                <Th>Rating</Th>
                <Th>What they said</Th>
                <Th>Wants next</Th>
                <Th className="text-right">Issues</Th>
                <Th>Outcome</Th>
              </tr>
            </THead>
            <tbody>
              {q.isLoading ? (
                <tr>
                  <Td colSpan={7} className="py-10 text-center text-ink-soft">
                    Loading…
                  </Td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="py-10 text-center text-ink-soft">
                    No calls recorded yet. This fills as the follow-up queue is
                    worked.
                  </Td>
                </tr>
              ) : (
                rows.map((r) => (
                  <CallRow
                    key={r.followupId}
                    row={r}
                    open={openId === r.followupId}
                    onToggle={() =>
                      setOpenId(openId === r.followupId ? null : r.followupId)
                    }
                  />
                ))
              )}
            </tbody>
          </Table>
        </HScroll>

        {data && data.totalPages > 1 ? (
          <div className="border-t border-line px-4 py-2.5">
            <Pager
              page={data.page}
              totalPages={data.totalPages}
              onPage={setPage}
              busy={q.isFetching}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function CallRow({
  row,
  open,
  onToggle,
}: {
  row: CallRecord;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-line transition-colors",
          open ? "bg-accent-soft" : "hover:bg-surface-2",
        )}
      >
        <Td>
          <div className="num text-[13px] font-semibold text-ink">{row.orderNo}</div>
          <div className="max-w-[190px] truncate text-[12px] font-medium text-ink-soft">
            {row.partyName}
          </div>
        </Td>
        <Td className="num text-[12.5px] text-ink">
          {row.contactedAt ? (
            <>
              <div>{formatDateTime(row.contactedAt)}</div>
              {row.completedBy ? (
                <div className="max-w-[150px] truncate text-[11.5px] text-ink-soft">
                  {row.completedBy}
                </div>
              ) : null}
            </>
          ) : (
            <span className="text-ink-soft">not reached</span>
          )}
        </Td>
        <Td>
          {row.ratingOverall === null ? (
            <span className="text-ink-soft">—</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Stars value={row.ratingOverall} />
              <span className="num text-[12.5px] font-semibold">
                {row.ratingOverall}
              </span>
            </span>
          )}
        </Td>
        {/* The column this screen was built for. */}
        <Td className="max-w-[280px]">
          {row.feedback?.trim() ? (
            <span
              className="line-clamp-2 text-[12.5px] leading-snug font-medium text-ink"
              title={row.feedback}
            >
              {row.feedback}
            </span>
          ) : (
            <span className="text-[12.5px] text-ink-soft italic">nothing recorded</span>
          )}
        </Td>
        <Td className="max-w-[190px]">
          {row.reorderIntent === "none" ? (
            <span className="text-ink-soft">—</span>
          ) : (
            <>
              <Pill tone={row.reorderIntent === "yes" ? "done" : "progress"} dot={false}>
                {INTENT_LABEL[row.reorderIntent]}
              </Pill>
              {row.reorderNote ? (
                <div
                  className="mt-0.5 truncate text-[12px] text-ink"
                  title={row.reorderNote}
                >
                  {row.reorderNote}
                </div>
              ) : null}
            </>
          )}
        </Td>
        <Td className="num text-right">
          {row.issues ? (
            <span className={cn("font-semibold", row.openIssues ? "text-danger" : "text-ink")}>
              {row.issues}
            </span>
          ) : (
            <span className="text-ink-soft">—</span>
          )}
        </Td>
        <Td>
          <Pill
            tone={
              row.status === "COMPLETED"
                ? "done"
                : row.status === "UNREACHABLE"
                  ? "warn"
                  : "progress"
            }
            dot={false}
          >
            {STATUS_LABEL[row.status]}
          </Pill>
          {row.isEscalated ? (
            <div className="mt-0.5 text-[11px] font-semibold text-danger">
              escalated
            </div>
          ) : null}
        </Td>
      </tr>

      {open ? (
        <tr className="border-b border-line bg-surface-2">
          <Td colSpan={7} className="px-5 py-4 whitespace-normal">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <Label>Scores</Label>
                {row.subRatings.length === 0 ? (
                  <p className="text-[12.5px] text-ink-soft">Not rated.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {row.subRatings.map((s) => (
                      <li
                        key={s.key}
                        className="flex items-center justify-between gap-3 text-[12.5px]"
                      >
                        <span className="font-medium text-ink">{s.label}</span>
                        <span className="inline-flex items-center gap-1.5">
                          <Stars value={s.value} size={12} />
                          <span className="num font-semibold">{s.value}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {row.ratingSource ? (
                  <p className="mt-2 text-[12px] text-ink-soft">
                    {row.ratingSource === "customer"
                      ? "The customer stated these."
                      : "The coordinator judged these."}
                  </p>
                ) : null}
              </div>

              <div className="md:col-span-2">
                <Label>In their own words</Label>
                {row.feedback?.trim() ? (
                  <p className="rounded-field border-l-[3px] border-l-accent bg-surface px-3 py-3 text-[13px] leading-relaxed text-ink">
                    {row.feedback}
                  </p>
                ) : (
                  <p className="text-[12.5px] text-ink-soft">
                    Nothing was written down for this call.
                  </p>
                )}

                {row.reorderNote ? (
                  <>
                    <Label className="mt-4">What they need next</Label>
                    <p className="rounded-field border-l-[3px] border-l-success bg-surface px-3 py-3 text-[13px] leading-relaxed text-ink">
                      {row.reorderNote}
                    </p>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-[12.5px] text-ink-soft">
              <span>
                Order value{" "}
                <b className="num text-ink">{money(row.orderValue)}</b>
              </span>
              <span>
                Attempts <b className="num text-ink">{row.attempts}</b>
                {row.channels.length
                  ? ` · ${row.channels.map((c) => CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c).join(", ")}`
                  : ""}
              </span>
              <span>
                On time, they said{" "}
                <b className="text-ink">
                  {row.customerSaysOnTime === null
                    ? "not asked"
                    : row.customerSaysOnTime
                      ? "yes"
                      : `no${row.delayReason ? ` · ${row.delayReason}` : ""}`}
                </b>
              </span>
              {row.salesPerson ? (
                <span>
                  Sales <b className="text-ink">{row.salesPerson}</b>
                </span>
              ) : null}
            </div>
          </Td>
        </tr>
      ) : null}
    </>
  );
}

function Label({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-ink uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}
