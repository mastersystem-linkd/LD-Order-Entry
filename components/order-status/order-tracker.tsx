"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, RefreshCwIcon, SearchIcon } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { formatDate, formatNumber } from "@/lib/orders";
import type { OrderStatusList, OrderStatusRow } from "@/lib/order-status";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { TrackerDetail } from "./tracker-detail";
import {
  flattenLines,
  toneOfLines,
  toQualityGroups,
  TONE_LABEL,
  TONE_TEXT,
  type QualityGroup,
} from "./quality-groups";

// Widths of the three identifying columns, which stay pinned while the rest of
// the row scrolls sideways. The operator's complaint was losing track of which
// quality a row belonged to once they scrolled — so these never leave.
const W_ORDER = 84;
const W_PARTY = 168;
const W_QUALITY = 176;
const L_PARTY = W_ORDER;
const L_QUALITY = W_ORDER + W_PARTY;

const stickyBase =
  "sticky z-[2] border-r border-line px-2.5 py-2 align-middle";
// Body cells take the row's own background so the pinned columns keep the
// hover / selected tint. Header cells are given an opaque one outright —
// stacking two background utilities would leave the winner to CSS source
// order, and a see-through sticky header is exactly the bug being fixed.
const stickyCell = `${stickyBase} bg-[inherit]`;
const stickyHead = `${stickyBase} bg-surface`;

// Search → grouped rows on the left → full status on the right, with ← / → to
// walk the matches. One screen for the whole "where is this order?" question.
export function OrderTracker({
  initialSearch = "",
  /** Rendered inside the search bar, e.g. a view switch. */
  toolbar,
}: {
  initialSearch?: string;
  toolbar?: React.ReactNode;
}) {
  const [searchInput, setSearchInput] = React.useState(initialSearch);
  const search = useDebouncedValue(searchInput, 300);
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Collapsed by default — one row per quality is the point. The colour chips
  // on that row already answer "what went out?", so opening it is optional.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setPage(1);
  }, [search]);

  const q = useQuery({
    queryKey: ["order-tracker", { search, page }],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      p.set("page", String(page));
      return apiGet<OrderStatusList>(`/api/order-status?${p}`);
    },
    placeholderData: (prev) => prev,
  });

  const groups = React.useMemo(
    () => toQualityGroups(q.data?.groups ?? []),
    [q.data],
  );
  // The flat list the arrows walk — every colour, in the order shown.
  const lines = React.useMemo(() => flattenLines(groups), [groups]);

  // Nothing is selected until a row is clicked — the table keeps the full width
  // until then. A selection that falls out of the results is dropped.
  React.useEffect(() => {
    setSelectedId((cur) =>
      cur && lines.some((l) => l.lineId === cur) ? cur : null,
    );
  }, [lines]);

  const index = selectedId
    ? lines.findIndex((l) => l.lineId === selectedId)
    : -1;
  const selected = index >= 0 ? lines[index] : undefined;
  const selectedGroup = selected
    ? groups.find((g) => g.key === `${selected.orderId}|${selected.fabric}`)
    : undefined;

  const hasSelection = index >= 0;

  const step = React.useCallback(
    (by: number) => {
      if (lines.length === 0) return;
      const next = (index + by + lines.length) % lines.length;
      setSelectedId(lines[next].lineId);
    },
    [index, lines],
  );

  // ← / → step through the matches without leaving the keyboard, as long as the
  // user is not typing in the search box.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (!hasSelection) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, hasSelection]);

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const totalOrders = q.data?.total ?? 0;
  const totalPages = q.data?.totalPages ?? 1;
  const safePage = q.data?.page ?? page;

  return (
    <div className="flex flex-col gap-3">
      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search order no or party name…"
            aria-label="Search order no or party name"
            className="h-10 w-full pl-9"
          />
        </div>
        {toolbar}
        <Button
          variant="outline"
          size="icon"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          aria-label="Refresh"
          className="shrink-0"
        >
          {q.isFetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>

      {/* What the row text colour means — say it once, plainly. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="font-medium text-ink-muted">Row text colour</span>
        <span className="font-semibold text-success">Completed</span>
        <span className="font-semibold text-warning">In progress</span>
        <span className="font-semibold text-danger">Not started</span>
        <span className="font-semibold text-ink-muted">Cancelled</span>
      </div>

      {/* The table keeps the whole width. The detail panel floats over its
          right-hand edge when a row is opened, so nothing is resized and
          whatever it covers is still reachable by scrolling the table. */}
      <div className="relative">
        <Card className="min-w-0 overflow-hidden p-0">
          {q.isLoading && !q.data ? (
            <p className="flex items-center gap-2 px-4 py-10 text-sm text-ink-soft">
              <Spinner /> Loading orders…
            </p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-soft">
              {search
                ? `Nothing matches “${search}”.`
                : "No orders to show."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-line bg-surface">
                  <tr className="bg-surface text-[12px] font-bold tracking-[0.04em] text-ink uppercase">
                    <th
                      className={cn(stickyHead, "left-0")}
                      style={{ width: W_ORDER, minWidth: W_ORDER }}
                    >
                      Order no
                    </th>
                    <th
                      className={stickyHead}
                      style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
                    >
                      Party
                    </th>
                    <th
                      className={stickyHead}
                      style={{
                        left: L_QUALITY,
                        width: W_QUALITY,
                        minWidth: W_QUALITY,
                      }}
                    >
                      Quality
                    </th>
                    <th className="px-2.5 py-2 whitespace-nowrap">OD date</th>
                    <th className="px-2.5 py-2 text-right whitespace-nowrap">
                      Designs
                    </th>
                    <th className="px-2.5 py-2 text-right whitespace-nowrap">
                      Mtr
                    </th>
                    <th className="px-2.5 py-2 whitespace-nowrap">Sales</th>
                    <th className="px-2.5 py-2 whitespace-nowrap">Status</th>
                    <th className="px-2.5 py-2 whitespace-nowrap">
                      Stage progress
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <QualityRows
                      key={g.key}
                      group={g}
                      open={expanded.has(g.key)}
                      selectedId={selectedId}
                      onToggle={() => toggleGroup(g.key)}
                      onSelect={setSelectedId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span className="num text-xs text-ink-soft">
                {totalOrders} orders · page {safePage} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>

        {hasSelection ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-full max-w-[380px] p-2">
            <div className="pointer-events-auto sticky top-2 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl">
              <TrackerDetail
                line={selected}
                group={selectedGroup}
                index={index}
                total={lines.length}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onSelectLine={setSelectedId}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The seven stages, named. The old column showed a strip of design numbers,
// which read as noise — "1 3 4 5 09" tells an operator nothing about where the
// work has reached. Names do.
function StageChips({ lines }: { lines: OrderStatusRow[] }) {
  // Labels come from the stage rows themselves (workflow_stages), so renaming a
  // stage in Settings renames it here too.
  const template = lines[0]?.stages ?? [];
  const n = lines.length;

  return (
    <div className="flex flex-wrap gap-1">
      {template.map((st, i) => {
        const cells = lines.map((l) => l.stages[i]);
        const done = cells.filter((c) => c?.state === "done").length;
        const overdue = cells.some((c) => c?.state === "overdue");
        const all = done === n && n > 0;
        const some = done > 0 && !all;
        return (
          <span
            key={st.stageKey}
            title={
              n > 1
                ? `${st.label}: ${done} of ${n} designs done`
                : `${st.label}: ${cells[0]?.state.replace("_", " ") ?? "not started"}`
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
              all
                ? "border-success/40 bg-success/10 text-success"
                : some
                  ? "border-warning/40 bg-warning/10 text-warning"
                  : overdue
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-line bg-surface-2 text-ink-muted",
            )}
          >
            {all ? <span aria-hidden>✓</span> : null}
            {st.label}
            {n > 1 && !all ? <span className="num">{done}/{n}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

// One quality: a named-stage strip showing how far its designs have got, and —
// when opened — a row per colour with the same strip for that colour alone.
function QualityRows({
  group,
  open,
  selectedId,
  onToggle,
  onSelect,
}: {
  group: QualityGroup;
  open: boolean;
  selectedId: string | null;
  onToggle: () => void;
  onSelect: (lineId: string) => void;
}) {
  const holdsSelection = group.lines.some((l) => l.lineId === selectedId);

  return (
    <>
      <tr
        onClick={() => onSelect(group.lines[0].lineId)}
        title={`${TONE_LABEL[group.tone]} — click for full details`}
        className={cn(
          "cursor-pointer border-b border-line transition-colors",
          // Background stays neutral; the STATUS is the text colour.
          holdsSelection ? "bg-accent/10" : "bg-surface hover:bg-inset",
          TONE_TEXT[group.tone],
        )}
      >
        <td
          className={cn(stickyCell, "num font-semibold")}
          style={{ left: 0, width: W_ORDER, minWidth: W_ORDER }}
        >
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              aria-label={open ? "Hide colours" : "Show colours"}
              aria-expanded={open}
              className="-ml-1 rounded p-0.5 opacity-60 hover:bg-inset hover:opacity-100"
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
            {group.orderNo}
          </span>
        </td>
        <td
          className={cn(stickyCell, "truncate")}
          style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
          title={group.party}
        >
          {group.party}
        </td>
        <td
          className={cn(stickyCell, "truncate font-medium")}
          style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
          title={group.fabric}
        >
          {group.fabric}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap">{formatDate(group.odDate)}</td>
        <td className="num px-2.5 py-2 text-right whitespace-nowrap">
          {group.lines.length}
        </td>
        <td className="num px-2.5 py-2 text-right whitespace-nowrap">
          {formatNumber(group.qtyTotal)}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap">
          {group.salesPerson || "—"}
        </td>
        <td className="px-2.5 py-2 font-medium whitespace-nowrap">
          {TONE_LABEL[group.tone]}
        </td>
        <td className="px-2.5 py-2">
          <StageChips lines={group.lines} />
        </td>
      </tr>

      {open
        ? group.lines.map((l) => (
            <ColourRow
              key={l.lineId}
              line={l}
              selected={l.lineId === selectedId}
              onSelect={() => onSelect(l.lineId)}
            />
          ))
        : null}
    </>
  );
}

function ColourRow({
  line,
  selected,
  onSelect,
}: {
  line: OrderStatusRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = toneOfLines([line]);
  return (
    <tr
      onClick={onSelect}
      title={`${TONE_LABEL[tone]} — click for full details`}
      className={cn(
        "cursor-pointer border-b border-line transition-colors",
        selected ? "bg-accent/10" : "bg-surface-2 hover:bg-inset",
        TONE_TEXT[tone],
      )}
    >
      <td className={stickyCell} style={{ left: 0, width: W_ORDER, minWidth: W_ORDER }} />
      <td
        className={stickyCell}
        style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
      />
      <td
        className={cn(stickyCell, "num truncate")}
        style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
        title={`Design ${line.design}`}
      >
        <span className={cn("pl-5", line.isCancelled && "line-through")}>
          {line.design}
        </span>
      </td>
      <td className="px-2.5 py-1.5" />
      <td className="px-2.5 py-1.5" />
      <td className="num px-2.5 py-1.5 text-right whitespace-nowrap">
        {formatNumber(Number(line.qtyMtr))}
      </td>
      <td className="px-2.5 py-1.5" />
      <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">
        {TONE_LABEL[tone]}
      </td>
      <td className="px-2.5 py-1.5">
        <StageChips lines={[line]} />
      </td>
    </tr>
  );
}
