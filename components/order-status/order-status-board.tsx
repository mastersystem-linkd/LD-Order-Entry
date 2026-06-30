"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckIcon,
  DownloadIcon,
  ListChecksIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/orders";
import {
  STAGE_DOT,
  STAGE_OPTIONS,
  type OrderStatusList,
  type OrderStatusRow,
  type OverallStatus,
  type StageCell,
} from "@/lib/order-status";
import type { Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useLookup } from "@/components/orders/use-lookups";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { StatusDrawer } from "@/components/order-status/status-drawer";

const OVERALL: Record<OverallStatus, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-success/10 text-success" },
  in_progress: { label: "In progress", cls: "bg-warning/10 text-warning" },
  overdue: { label: "Overdue", cls: "bg-danger/10 text-danger" },
};

const selectCls =
  "h-9 rounded-field border border-line-strong bg-surface-2 px-2 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

export function OrderStatusBoard({ role }: { role: Role }) {
  const [searchInput, setSearchInput] = React.useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [dept, setDept] = React.useState("ALL");
  const [sales, setSales] = React.useState("");
  const [party, setParty] = React.useState("");
  const [fabric, setFabric] = React.useState("");
  const [stage, setStage] = React.useState("");
  const [overall, setOverall] = React.useState<OverallStatus | "">("");
  const [sort, setSort] = React.useState("od_date");
  const [page, setPage] = React.useState(1);
  const [showFilters, setShowFilters] = React.useState(false);
  const [selected, setSelected] = React.useState<number | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const parties = useLookup("PARTY").data ?? [];
  const salesPeople = useLookup("SALES_PERSON").data ?? [];
  const fabrics = useLookup("FABRIC").data ?? [];

  // Reset to page 1 whenever a filter changes.
  React.useEffect(() => {
    setPage(1);
  }, [search, dept, sales, party, fabric, stage, overall, sort]);

  const queryString = React.useCallback(
    (all?: boolean) => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (dept !== "ALL") p.set("department", dept);
      if (sales) p.set("sales_person", sales);
      if (party) p.set("party", party);
      if (fabric) p.set("fabric", fabric);
      if (stage) p.set("stage", stage);
      if (overall) p.set("overall", overall);
      p.set("sort", sort);
      if (all) p.set("all", "1");
      else p.set("page", String(page));
      return p.toString();
    },
    [search, dept, sales, party, fabric, stage, overall, sort, page],
  );

  const q = useQuery({
    queryKey: [
      "order-status",
      { search, dept, sales, party, fabric, stage, overall, sort, page },
    ],
    queryFn: () => apiGet<OrderStatusList>(`/api/order-status?${queryString()}`),
    placeholderData: (prev) => prev,
  });

  const data = q.data;
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  function clearFilters() {
    setSales("");
    setParty("");
    setFabric("");
    setStage("");
    setDept("ALL");
    setOverall("");
  }
  const hasActiveFilters =
    sales || party || fabric || stage || dept !== "ALL" || overall;

  async function exportCsv() {
    setExporting(true);
    try {
      const all = await apiGet<OrderStatusList>(
        `/api/order-status?${queryString(true)}`,
      );
      const header = [
        "Order no",
        "Party",
        "Fabric",
        "Design",
        "Mtr",
        "Sales",
        "OD date",
        ...STAGE_OPTIONS.map((s) => s.label),
        "Done",
        "Overall",
      ];
      const body = all.rows.map((r) => [
        r.orderNo,
        r.party,
        r.fabric,
        r.design,
        r.qtyMtr,
        r.salesPerson ?? "",
        r.odDate,
        ...r.stages.map((st) =>
          st.state === "done"
            ? `Done ${st.date ? formatDate(st.date) : ""}`.trim()
            : st.state,
        ),
        `${r.doneCount}/7`,
        r.overall,
      ]);
      const csv = [header, ...body]
        .map((row) => row.map(csvCell).join(","))
        .join("\n");
      download(csv, `order-status-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${all.rows.length} lines.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<ListChecksIcon />}
          tone="slate"
          label="Total lines"
          value={summary?.total}
          active={overall === ""}
          onClick={() => setOverall("")}
        />
        <SummaryCard
          tone="amber"
          label="In progress"
          value={summary?.inProgress}
          active={overall === "in_progress"}
          onClick={() => setOverall("in_progress")}
        />
        <SummaryCard
          tone="green"
          label="Completed"
          value={summary?.completed}
          active={overall === "completed"}
          onClick={() => setOverall("completed")}
        />
        <SummaryCard
          tone="red"
          label="Overdue"
          value={summary?.overdue}
          active={overall === "overdue"}
          onClick={() => setOverall("overdue")}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order no, party, fabric, design, sales…"
              className="pl-8"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFilters((s) => !s)}
              aria-pressed={showFilters}
            >
              <SlidersHorizontalIcon /> Filters
              {hasActiveFilters ? (
                <span className="ml-1 size-1.5 rounded-full bg-accent" />
              ) : null}
            </Button>
            <Button
              variant="outline"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh"
            >
              {q.isFetching ? <Spinner /> : <RefreshCwIcon />}
            </Button>
            <Button onClick={exportCsv} disabled={exporting || !rows.length}>
              {exporting ? <Spinner className="text-white" /> : <DownloadIcon />}{" "}
              Export
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="flex flex-wrap items-center gap-2 rounded-field border border-line bg-surface-2 p-2.5">
            <FilterSelect label="Sales" value={sales} onChange={setSales} options={salesPeople} />
            <FilterSelect label="Party" value={party} onChange={setParty} options={parties} />
            <FilterSelect label="Fabric" value={fabric} onChange={setFabric} options={fabrics} />
            <select
              className={selectCls}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="At stage"
            >
              <option value="">Any stage</option>
              {STAGE_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  At: {s.label}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              aria-label="Department"
            >
              <option value="ALL">All depts</option>
              <option value="LD">LD</option>
              <option value="LINKD">LinkD</option>
            </select>
            <select
              className={selectCls}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort"
            >
              <option value="od_date">Sort: OD date</option>
              <option value="order_no">Sort: Order no</option>
              <option value="party">Sort: Party</option>
              <option value="progress">Sort: Progress</option>
            </select>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <XIcon /> Clear
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Table */}
      <Card data-size="sm">
        <CardContent className="px-0">
          {q.isLoading && !data ? (
            <div className="flex items-center gap-2 px-4 py-10 text-sm text-ink-soft">
              <Spinner /> Loading status…
            </div>
          ) : q.isError ? (
            <div className="px-4 py-10 text-sm text-danger">
              {(q.error as Error)?.message ?? "Failed to load."}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-ink-muted">
              No lines match your filters.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-20 bg-surface">
                  <tr className="border-b border-line text-[11px] font-semibold text-ink">
                    <Th className="sticky left-0 z-30 bg-surface shadow-[1px_1px_0_var(--line)]">
                      Order no
                    </Th>
                    <Th>Party</Th>
                    <Th>Fabric</Th>
                    <Th>Design</Th>
                    <Th className="text-right">Mtr</Th>
                    <Th>Sales</Th>
                    {STAGE_OPTIONS.map((s) => (
                      <Th key={s.key} className="min-w-[104px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              STAGE_DOT[s.key] ?? "bg-ink-muted",
                            )}
                          />
                          {s.label}
                        </span>
                      </Th>
                    ))}
                    <Th className="min-w-[96px]">Progress</Th>
                    <Th>Overall</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.lineId}
                      onClick={() => setSelected(i)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${r.orderNo} — ${r.party}, ${r.fabric} ${r.design}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(i);
                        }
                      }}
                      className="group cursor-pointer border-b border-line transition-colors outline-none last:border-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)]"
                    >
                      <Td className="num sticky left-0 z-10 bg-surface font-medium text-ink shadow-[1px_0_0_var(--line)] group-hover:bg-surface-2 group-focus-visible:bg-surface-2">
                        {r.orderNo}
                      </Td>
                      <Td className="whitespace-nowrap text-ink">{r.party}</Td>
                      <Td className="whitespace-nowrap text-ink">{r.fabric}</Td>
                      <Td className="num whitespace-nowrap text-ink">
                        {r.design}
                      </Td>
                      <Td className="num whitespace-nowrap text-right text-ink">
                        {formatNumber(Number(r.qtyMtr))}
                      </Td>
                      <Td className="whitespace-nowrap text-ink">
                        {r.salesPerson ?? "—"}
                      </Td>
                      {r.stages.map((c) => (
                        <Td key={c.stageKey}>
                          <StageChip cell={c} />
                        </Td>
                      ))}
                      <Td>
                        <ProgressBar row={r} />
                      </Td>
                      <Td>
                        <span
                          className={cn(
                            "inline-flex rounded-pill px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                            OVERALL[r.overall].cls,
                          )}
                        >
                          {OVERALL[r.overall].label}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="num text-ink-soft">
            {data.total} line{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || q.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="num">
              {data.page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages || q.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {/* Detail drawer */}
      {selected != null && rows[selected] ? (
        <StatusDrawer
          lineId={rows[selected].lineId}
          role={role}
          onClose={() => setSelected(null)}
          onPrev={() => setSelected((s) => (s == null ? s : Math.max(0, s - 1)))}
          onNext={() =>
            setSelected((s) =>
              s == null ? s : Math.min(rows.length - 1, s + 1),
            )
          }
          hasPrev={selected > 0}
          hasNext={selected < rows.length - 1}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | undefined;
  tone: "slate" | "amber" | "green" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const dot =
    tone === "green"
      ? "bg-success"
      : tone === "amber"
        ? "bg-warning"
        : tone === "red"
          ? "bg-danger"
          : "bg-ink-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-card border bg-surface p-3.5 text-left shadow-sm transition-colors",
        active ? "border-accent ring-2 ring-[var(--accent-ring)]" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
        {icon ? (
          <span className="text-ink-muted [&_svg]:size-3.5">{icon}</span>
        ) : (
          <span className={cn("size-2 rounded-full", dot)} />
        )}
        {label}
      </div>
      <div className="num mt-1 text-[26px] font-semibold text-ink">
        {value == null ? "—" : value}
      </div>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function StageChip({ cell }: { cell: StageCell }) {
  if (cell.state === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-1 text-[11px] font-medium text-success">
        <CheckIcon className="size-3 shrink-0" />
        <span className="num">{cell.date ? formatDate(cell.date) : "done"}</span>
      </span>
    );
  }
  if (cell.state === "in_progress") {
    return (
      <span className="inline-flex rounded-md bg-warning/10 px-1.5 py-1 text-[11px] font-medium text-warning">
        In progress
      </span>
    );
  }
  if (cell.state === "overdue") {
    return (
      <span className="num inline-flex rounded-md bg-danger/10 px-1.5 py-1 text-[11px] font-medium text-danger">
        {cell.daysOverdue}d late
      </span>
    );
  }
  return <span className="text-ink-muted">–</span>;
}

function ProgressBar({ row }: { row: OrderStatusRow }) {
  return (
    <div
      role="img"
      aria-label={`${row.doneCount} of ${row.stages.length} stages done`}
      className="flex min-w-[84px] gap-0.5"
    >
      {row.stages.map((s) => (
        <span
          key={s.stageKey}
          title={s.label}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            s.state === "done"
              ? "bg-success"
              : s.stageKey === row.currentStageKey
                ? "bg-accent"
                : "bg-inset",
          )}
        />
      ))}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2.5 whitespace-nowrap", className)}>{children}</th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-2.5 align-middle", className)}>{children}</td>;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(content: string, filename: string) {
  const blob = new Blob(["﻿" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
