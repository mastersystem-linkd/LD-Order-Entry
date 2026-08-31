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
  categoryLabel,
  ISSUE_RESOLUTIONS,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  OWNER_DEPTS,
  type IssueList,
  type IssueResolution,
  type IssueRow,
} from "@/lib/crm";
import { formatCount, formatDate, formatNumber } from "@/lib/orders";
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

// The department that has to act. The raw enum (OPS / DISPATCH / ACCOUNTS)
// is shouted and ambiguous in a cell on its own.
const DEPT_LABEL: Record<string, string> = {
  OPS: "Operations",
  DISPATCH: "Dispatch",
  DESIGN: "Design",
  ACCOUNTS: "Accounts",
  TRANSPORT: "Transport",
  SALES: "Sales",
};

function money(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${formatNumber(n)}`;
}

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
  // Complaint categories are managed data now (Settings → CRM), so the filter
  // is populated from the same list the call panel writes into.
  const categoryList = useQuery({
    queryKey: ["lookups", "CRM_ISSUE"],
    // NOTE: without ?all=1 this endpoint returns a plain string[], not row
    // objects. Typing it as {value}[] produced an array of undefined and took
    // the whole panel down on mount.
    queryFn: () => apiGet<string[]>("/api/lookups?category=CRM_ISSUE"),
  });
  const categories = (categoryList.data ?? []).filter((v): v is string => !!v);

  const [status, setStatus] = React.useState<string>("OPEN_ANY");
  const [category, setCategory] = React.useState("");
  const [severity, setSeverity] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [groupBy, setGroupBy] = React.useState<"dept" | "category">("dept");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
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
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (search) params.set("q", search);
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-issues", qs],
    queryFn: () => apiGet<IssueList>(`/api/crm/issues?${qs}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    setPage(1);
  }, [status, category, severity, dept, from, to, search]);

  const data = q.data;
  const rows = data?.rows ?? [];
  const k = data?.kpis;

  // Each tile narrows the board to what it counts, and clicking the active one
  // puts it back — a KPI you can act on beats one you can only read. The
  // status chips above stay in sync because they read the same state.
  const openish = status === "OPEN_ANY" && !severity;
  const showOpen = () => {
    setStatus("OPEN_ANY");
    setSeverity("");
  };
  const showHighSeverity = () => {
    if (severity === "HIGH") {
      setSeverity("");
      return;
    }
    setStatus("OPEN_ANY");
    setSeverity("HIGH");
  };
  const showResolved = () => {
    setSeverity("");
    setStatus(status === "RESOLVED" ? "OPEN_ANY" : "RESOLVED");
  };
  const groups = groupBy === "dept" ? (data?.byDept ?? []) : (data?.byCategory ?? []);

  return (
    <div className="flex flex-col gap-3">
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
          {categories.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
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
          <option value="">Anyone&rsquo;s to fix</option>
          {OWNER_DEPTS.map((d) => (
            <option key={d} value={d}>
              {DEPT_LABEL[d] ?? d}
            </option>
          ))}
        </select>

        {/* Window on when the complaint was RAISED — an old order can produce
            a new complaint, so filtering on order date would hide it. */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Raised from"
            className={selectCls}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-[12px] text-ink-soft">to</span>
          <input
            type="date"
            aria-label="Raised to"
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
              className="cursor-pointer rounded-field px-1.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-inset hover:text-ink"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="relative min-w-[180px] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-soft" />
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

      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<TriangleAlertIcon />}
          label="Open issues"
          value={k?.open ?? 0}
          sub={openish ? "showing open" : "show open only"}
          tone="red"
          active={openish}
          onClick={showOpen}
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<IndianRupeeIcon />}
          label="Value at risk"
          value={k ? `₹${formatNumber(k.valueAtRisk)}` : "—"}
          tone="amber"
          sub={openish ? "counted once per order" : "show the open ones"}
          active={openish}
          onClick={showOpen}
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<ClockIcon />}
          label="Median resolution"
          value={k?.medianResolutionDays != null ? `${k.medianResolutionDays} d` : "—"}
          tone="slate"
          sub={
            status === "RESOLVED"
              ? "showing resolved"
              : k?.medianResolutionDays == null
                ? "nothing resolved yet"
                : "see the resolved ones"
          }
          active={status === "RESOLVED"}
          onClick={showResolved}
        />
        <StatCard
          className="py-2.5 sm:py-3"
          icon={<AlertTriangleIcon />}
          label="High severity"
          value={k?.highSeverity ?? 0}
          tone="red"
          sub={severity === "HIGH" ? "showing high only" : "show high only"}
          active={severity === "HIGH"}
          onClick={showHighSeverity}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[196px_1fr]">
        {/* Group-by rail — who has to act, or what keeps happening */}
        <Card className="h-fit">
          <div className="px-3 pt-3 pb-2">
            <Segmented
              size="sm"
              className="w-full"
              ariaLabel="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "dept", label: "By who fixes it" },
                { value: "category", label: "By category" },
              ]}
            />
          </div>
          <CardContent className="px-2 pb-3">
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-ink-soft">
                Nothing to break down yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {groups.map((g) => {
                  const active =
                    groupBy === "dept" ? dept === g.key : category === g.key;
                  const label =
                    groupBy === "dept"
                      ? (DEPT_LABEL[g.key] ?? g.key)
                      : categoryLabel(g.key);
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
          {/* One line, not a title over a paragraph. The rule the list obeys
              is worth stating once; it is not worth 60px of every screen. */}
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-2.5 sm:px-5">
            <CardTitle className="text-[15px]">Complaints</CardTitle>
            {data ? (
              <span className="num rounded-pill bg-inset px-2 py-0.5 text-[12px] font-semibold text-ink-soft">
                {data.total}
              </span>
            ) : null}
            <span className="text-[12px] text-ink-soft">
              worst first · click a row to resolve
            </span>
          </div>

          <CardContent className="px-0">
            <HScroll bodyClassName="overflow-x-auto">
              <Table>
                <THead className="bg-inset">
                  <tr>
                    <Th>Order &middot; party</Th>
                    <Th>Complaint</Th>
                    <Th>Fabric &middot; design</Th>
                    <Th className="text-right">Affected</Th>
                    <Th className="text-right">Order value</Th>
                    <Th>Severity</Th>
                    {/* Not "Owner" — that read as the transport company
                        rather than the department that has to fix it. */}
                    <Th>Whose to fix</Th>
                    <Th className="text-right">Open</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {q.isLoading ? (
                    <tr>
                      <Td colSpan={9} className="px-4 py-10 text-center text-ink-soft">
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
                        <div className="mx-auto mt-1.5 max-w-[52ch] text-[12.5px] leading-[1.6] text-ink-soft">
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
          "group cursor-pointer border-b border-line transition-colors",
          open ? "bg-accent-soft" : "hover:bg-surface-2",
        )}
      >
        {/* Order and party are ONE fact — which order, for whom. Two columns
            spent half the width on repeating the same identity. */}
        <Td>
          <div className="num text-[13px] font-semibold text-ink">{row.orderNo}</div>
          <div className="max-w-[190px] truncate text-[12px] text-ink-soft">
            {row.partyName}
          </div>
        </Td>

        {/* The complaint itself. The board previously showed the category and
            hid the description entirely — so a list of complaints never said
            what anyone actually complained about. */}
        <Td className="max-w-[300px]">
          <div className="truncate text-[13px] font-medium text-ink">
            {categoryLabel(row.category)}
          </div>
          {row.description ? (
            <div
              className="truncate text-[12.5px] font-medium text-ink-soft"
              title={row.description}
            >
              {row.description}
            </div>
          ) : (
            <div className="text-[12px] text-ink-soft italic">
              no detail recorded
            </div>
          )}
        </Td>

        <Td>
          {row.quality ? (
            <>
              <div className="max-w-[150px] truncate text-[12.5px] font-medium text-ink">
                {row.quality}
              </div>
              <div className="num text-[12px] text-ink-soft">{row.designNo}</div>
            </>
          ) : (
            <span className="text-[12.5px] text-ink-soft">Whole order</span>
          )}
        </Td>

        <Td className="num text-right whitespace-nowrap">
          {row.qtyAffected != null ? (
            <span className="font-medium">{formatNumber(row.qtyAffected)} m</span>
          ) : (
            <span className="text-ink-soft">—</span>
          )}
        </Td>

        {/* What the complaint puts at risk. A shortage on a ₹40k order and one
            on a ₹18L order are not the same problem. */}
        <Td className="num text-right whitespace-nowrap">
          {row.orderValue > 0 ? (
            <span className="font-semibold">{money(row.orderValue)}</span>
          ) : (
            <span className="text-ink-soft">—</span>
          )}
        </Td>

        <Td>
          <Pill tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Pill>
        </Td>

        {/* "Owner: TRANSPORT" read as the transport company. It is the
            department that has to FIX it, so the column says so. */}
        <Td>
          {row.ownerDept ? (
            <span className="inline-flex items-center rounded-md bg-inset px-2 py-[3px] text-[11.5px] font-semibold tracking-wide text-ink-soft">
              {DEPT_LABEL[row.ownerDept] ?? row.ownerDept}
            </span>
          ) : (
            <span className="text-ink-soft">unassigned</span>
          )}
        </Td>

        <Td className="num text-right whitespace-nowrap">
          <span
            className={cn(
              "font-medium",
              !closed && row.ageDays >= 14
                ? "text-danger"
                : !closed && row.ageDays >= 7
                  ? "text-warning"
                  : "text-ink-soft",
            )}
          >
            {row.ageDays}d
          </span>
        </Td>

        <Td>
          <Pill tone={STATUS_TONE[row.status]} dot={false}>
            {STATUS_TEXT[row.status]}
          </Pill>
          {row.resolution ? (
            <div className="mt-0.5 text-[11.5px] text-ink-soft">
              {RESOLUTION_LABEL[row.resolution]}
            </div>
          ) : null}
        </Td>
      </tr>

      {open ? (
        <tr className="border-b border-line bg-surface-2">
          <Td colSpan={9} className="px-4 py-3.5 whitespace-normal">
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-[11.5px] tracking-[0.05em] text-ink-soft uppercase">
                  What happened
                </div>
                <p className="mt-0.5 text-[13px] text-ink">
                  {row.description || "No description was recorded."}
                </p>
                <p className="mt-1 text-[12px] text-ink-soft">
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
