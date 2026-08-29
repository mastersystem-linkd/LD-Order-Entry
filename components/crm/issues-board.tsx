"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ClockIcon,
  IndianRupeeIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  CATEGORY_LABEL,
  ISSUE_CATEGORIES,
  ISSUE_RESOLUTIONS,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  OWNER_DEPTS,
  type IssueList,
  type IssueResolution,
  type IssueRow,
} from "@/lib/crm";
import { formatDate, formatNumber } from "@/lib/orders";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { HScroll } from "@/components/ui/h-scroll";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { Pill } from "@/components/crm/crm-pill";

// The complaint board (CLAUDE.md §12.5, OE-P17). Every issue points at a LINE,
// so this list is also the raw material for defect rate by fabric, design,
// transport and month.

const STATUS_TABS = [
  { value: "OPEN_ANY", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ALL", label: "All" },
] as const;

const selectCls =
  "h-9 rounded-field border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

const SEVERITY_TONE = { HIGH: "late", MEDIUM: "warn", LOW: "due" } as const;
const SEVERITY_LABEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" } as const;
const STATUS_TONE = {
  OPEN: "due",
  IN_PROGRESS: "progress",
  RESOLVED: "done",
  REJECTED: "warn",
} as const;
const STATUS_TEXT = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
} as const;
const RESOLUTION_LABEL: Record<IssueResolution, string> = {
  CREDIT_NOTE: "Credit note",
  REPLACEMENT: "Replacement",
  REPRINT: "Reprint",
  DISCOUNT: "Discount",
  EXPLAINED: "Explained",
  NO_ACTION: "No action",
};

export function IssuesBoard({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = React.useState<string>("OPEN_ANY");
  const [category, setCategory] = React.useState("");
  const [severity, setSeverity] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [groupBy, setGroupBy] = React.useState<"dept" | "category">("dept");
  const [rawSearch, setRawSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const search = useDebouncedValue(rawSearch, 250);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("status", status);
  if (category) params.set("category", category);
  if (severity) params.set("severity", severity);
  if (dept) params.set("dept", dept);
  if (search) params.set("q", search);
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-issues", qs],
    queryFn: () => apiGet<IssueList>(`/api/crm/issues?${qs}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    setPage(1);
  }, [status, category, severity, dept, search]);

  const data = q.data;
  const rows = data?.rows ?? [];
  const k = data?.kpis;
  const groups = groupBy === "dept" ? (data?.byDept ?? []) : (data?.byCategory ?? []);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setStatus(t.value)}
            className={cn(
              "cursor-pointer rounded-pill px-3.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150",
              status === t.value
                ? "bg-accent text-white"
                : "text-ink-soft hover:bg-inset hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}

        <select
          className={selectCls}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {ISSUE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>

        <select
          className={selectCls}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">All severities</option>
          {ISSUE_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>

        <select className={selectCls} value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {OWNER_DEPTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <div className="relative min-w-[200px] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Order, party, quality or design…"
            className="h-9 pl-8"
          />
        </div>

        <button
          type="button"
          onClick={() => q.refetch()}
          title="Refresh"
          aria-label="Refresh"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-field border border-line bg-surface text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <RefreshCwIcon className={cn("size-4", q.isFetching && "animate-spin")} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          icon={<TriangleAlertIcon />}
          label="Open issues"
          value={k?.open ?? 0}
          tone="red"
        />
        <StatCard
          icon={<IndianRupeeIcon />}
          label="Value at risk"
          value={k ? `₹${formatNumber(k.valueAtRisk)}` : "—"}
          tone="amber"
          sub="Orders with an open complaint, counted once each"
        />
        <StatCard
          icon={<ClockIcon />}
          label="Median resolution"
          value={k?.medianResolutionDays != null ? `${k.medianResolutionDays} d` : "—"}
          tone="slate"
          sub={k?.medianResolutionDays == null ? "Nothing resolved yet" : undefined}
        />
        <StatCard
          icon={<AlertTriangleIcon />}
          label="High severity"
          value={k?.highSeverity ?? 0}
          tone="red"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        {/* Group-by rail — who has to act, or what keeps happening */}
        <Card className="h-fit">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <CardTitle className="text-[15px]">Breakdown</CardTitle>
          </div>
          <div className="px-4 pb-2">
            <Segmented
              size="sm"
              className="w-full"
              ariaLabel="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "dept", label: "By department" },
                { value: "category", label: "By category" },
              ]}
            />
          </div>
          <CardContent className="px-2 pb-3">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-ink-muted">
                Nothing to break down yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {groups.map((g) => {
                  const active =
                    groupBy === "dept" ? dept === g.key : category === g.key;
                  const label =
                    groupBy === "dept"
                      ? g.key
                      : (CATEGORY_LABEL[g.key as keyof typeof CATEGORY_LABEL] ?? g.key);
                  return (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() => {
                          if (groupBy === "dept") setDept(active ? "" : g.key);
                          else setCategory(active ? "" : g.key);
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-field px-2 py-1.5 text-left text-[12.5px] transition-colors",
                          active
                            ? "bg-accent-soft font-semibold text-accent-deep"
                            : "text-ink-soft hover:bg-inset hover:text-ink",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <span className="num shrink-0 font-semibold">{g.count}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <div className="px-4 pt-4 pb-3 sm:px-5">
            <CardTitle className="text-[17px]">Complaints</CardTitle>
            <CardDescription className="text-[11.5px]">
              Each issue points at a quality and design, so defect rate is
              computable by fabric, transport and salesperson.
              {data ? <span className="num"> {data.total} shown.</span> : null}
            </CardDescription>
          </div>

          <CardContent className="px-0">
            <HScroll bodyClassName="overflow-x-auto">
              <Table>
                <THead className="bg-inset">
                  <tr>
                    <Th>Order</Th>
                    <Th>Party</Th>
                    <Th>Quality / design</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Mtr</Th>
                    <Th>Severity</Th>
                    <Th>Owner</Th>
                    <Th className="text-right">Age</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {q.isLoading ? (
                    <tr>
                      <Td colSpan={9} className="px-4 py-10 text-center text-ink-muted">
                        Loading…
                      </Td>
                    </tr>
                  ) : q.isError ? (
                    <tr>
                      <Td colSpan={9} className="px-4 py-10 text-center">
                        <div className="font-semibold text-danger">
                          Could not load issues
                        </div>
                        <div className="mt-1 text-[12.5px] text-ink-soft">
                          {(q.error as Error)?.message ?? "Unknown error"}
                        </div>
                      </Td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <Td colSpan={9} className="px-4 py-12 text-center">
                        <div className="text-[13.5px] font-medium text-ink">
                          No complaints recorded.
                        </div>
                        {/* An empty board here is a real state, not a bug — say
                            which, or it reads as broken. */}
                        <div className="mx-auto mt-1.5 max-w-[52ch] text-[12.5px] leading-[1.6] text-ink-muted">
                          Issues are raised during a call, from the follow-up panel
                          on CRM → Follow-ups. Open a follow-up, work through “The
                          call”, and press <strong>+ Add issue</strong>.
                        </div>
                      </Td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <IssueRowView
                        key={r.id}
                        row={r}
                        open={openId === r.id}
                        canEdit={canEdit}
                        onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                        onSaved={() => {
                          setOpenId(null);
                          q.refetch();
                        }}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function IssueRowView({
  row,
  open,
  canEdit,
  onToggle,
  onSaved,
}: {
  row: IssueRow;
  open: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const closed = row.status === "RESOLVED" || row.status === "REJECTED";
  const [resolution, setResolution] = React.useState<IssueResolution>(
    row.resolution ?? "EXPLAINED",
  );
  const [note, setNote] = React.useState(row.resolutionNote ?? "");
  const [nextStatus, setNextStatus] = React.useState<string>(
    closed ? row.status : "RESOLVED",
  );

  const save = useMutation({
    mutationFn: () =>
      apiSend(`/api/crm/issues/${row.id}`, "PATCH", {
        status: nextStatus,
        // Only sent when closing — the schema requires a resolution for
        // RESOLVED and would reject a bare status change without one.
        resolution: nextStatus === "RESOLVED" ? resolution : null,
        resolution_note: note || null,
      }),
    onSuccess: () => {
      toast.success("Issue updated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-line transition-colors",
          open ? "bg-accent-soft" : "hover:bg-surface-2",
        )}
      >
        <Td className="num font-semibold">{row.orderNo}</Td>
        <Td className="max-w-[220px] truncate">{row.partyName}</Td>
        <Td>
          {row.quality ? (
            <>
              <div className="font-medium text-ink">{row.quality}</div>
              <div className="num text-[11.5px] text-ink-muted">{row.designNo}</div>
            </>
          ) : (
            <span className="text-ink-muted">Whole order</span>
          )}
        </Td>
        <Td>{CATEGORY_LABEL[row.category]}</Td>
        <Td className="num text-right">
          {row.qtyAffected != null ? formatNumber(row.qtyAffected) : "—"}
        </Td>
        <Td>
          <Pill tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Pill>
        </Td>
        <Td>
          {row.ownerDept ? (
            <span className="rounded-md bg-inset px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-soft">
              {row.ownerDept}
            </span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </Td>
        <Td className="num text-right text-ink-soft">{row.ageDays} d</Td>
        <Td>
          <Pill tone={STATUS_TONE[row.status]} dot={false}>
            {STATUS_TEXT[row.status]}
          </Pill>
        </Td>
      </tr>

      {open ? (
        <tr className="border-b border-line bg-surface-2">
          <Td colSpan={9} className="px-4 py-3.5 whitespace-normal">
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[10.5px] tracking-[0.05em] text-ink-muted uppercase">
                  What happened
                </div>
                <p className="mt-0.5 text-[13px] text-ink">
                  {row.description || "No description was recorded."}
                </p>
                <p className="mt-1 text-[11.5px] text-ink-muted">
                  Raised {formatDate(row.createdAt)}
                  {row.resolvedAt
                    ? ` · closed ${formatDate(row.resolvedAt)}${row.resolvedBy ? ` by ${row.resolvedBy}` : ""}`
                    : ""}
                  {row.orderValue > 0
                    ? ` · order value ₹${formatNumber(row.orderValue)}`
                    : ""}
                </p>
              </div>

              {closed ? (
                <div className="text-[12.5px] text-ink-soft">
                  Resolved as{" "}
                  <strong className="text-ink">
                    {row.resolution ? RESOLUTION_LABEL[row.resolution] : "—"}
                  </strong>
                  {row.resolutionNote ? ` — ${row.resolutionNote}` : ""}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={selectCls}
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                  >
                    {ISSUE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_TEXT[s]}
                      </option>
                    ))}
                  </select>
                  {nextStatus === "RESOLVED" ? (
                    <select
                      className={selectCls}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as IssueResolution)}
                    >
                      {ISSUE_RESOLUTIONS.map((r) => (
                        <option key={r} value={r}>
                          {RESOLUTION_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="How was it settled?"
                    className="h-9 min-w-[240px] flex-1"
                  />
                  <Button
                    size="lg"
                    disabled={!canEdit || save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
          </Td>
        </tr>
      ) : null}
    </>
  );
}
