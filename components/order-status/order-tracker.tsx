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
import { ColourChip, TrackerDetail } from "./tracker-detail";
import {
  flattenLines,
  isDispatched,
  toneOfLines,
  toQualityGroups,
  TONE_LABEL,
  TONE_ROW,
  TONE_ROW_SELECTED,
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

      {/* What the row colours mean — the tint is the status, so say so once. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        <span className="font-medium text-ink-muted">Row colour</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-success/40 ring-1 ring-success/40" />
          Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-warning/40 ring-1 ring-warning/40" />
          In progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-danger/40 ring-1 ring-danger/40" />
          Not started
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-line-strong" />
          Cancelled
        </span>
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
                    <th className="px-2.5 py-2 whitespace-nowrap">
                      Colours — dispatch status
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

// One quality: a summary row carrying every colour's dispatch state, and — when
// opened — a row per colour.
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
          holdsSelection ? TONE_ROW_SELECTED[group.tone] : TONE_ROW[group.tone],
        )}
      >
        <td
          className={cn(stickyCell, "left-0 num font-semibold text-ink")}
          style={{ width: W_ORDER, minWidth: W_ORDER }}
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
              className="-ml-1 rounded p-0.5 text-ink-muted hover:bg-inset hover:text-ink"
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", open && "rotate-90")}
              />
            </button>
            {group.orderNo}
          </span>
        </td>
        <td
          className={cn(stickyCell, "truncate text-ink-soft")}
          style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
          title={group.party}
        >
          {group.party}
        </td>
        <td
          className={cn(stickyCell, "truncate font-medium text-ink")}
          style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
          title={group.fabric}
        >
          {group.fabric}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap text-ink-soft">
          {formatDate(group.odDate)}
        </td>
        <td className="num px-2.5 py-2 text-right whitespace-nowrap text-ink">
          {group.lines.length}
        </td>
        <td className="num px-2.5 py-2 text-right whitespace-nowrap text-ink">
          {formatNumber(group.qtyTotal)}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap text-ink-soft">
          {group.salesPerson || "—"}
        </td>
        <td className="px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <span
              className={cn(
                "num rounded-pill px-2 py-0.5 text-[11px] font-semibold",
                group.pending === 0
                  ? "bg-success/10 text-success"
                  : group.dispatched === 0
                    ? "bg-warning/10 text-warning"
                    : "bg-inset text-ink-soft",
              )}
            >
              {group.dispatched}/{group.lines.length} dispatched
            </span>
            {group.lines.slice(0, 12).map((l) => (
              <ColourChip
                key={l.lineId}
                line={l}
                active={l.lineId === selectedId}
                onClick={() => onSelect(l.lineId)}
              />
            ))}
            {group.lines.length > 12 ? (
              <span className="num text-[11px] text-ink-muted">
                +{group.lines.length - 12} more
              </span>
            ) : null}
          </div>
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
  const out = isDispatched(line);
  const tone = toneOfLines([line]);
  return (
    <tr
      onClick={onSelect}
      title={`${TONE_LABEL[tone]} — click for full details`}
      className={cn(
        "cursor-pointer border-b border-line transition-colors",
        selected ? TONE_ROW_SELECTED[tone] : TONE_ROW[tone],
      )}
    >
      <td
        className={cn(stickyCell, "left-0")}
        style={{ width: W_ORDER, minWidth: W_ORDER }}
      />
      <td
        className={cn(stickyCell)}
        style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
      />
      <td
        className={cn(stickyCell, "num truncate text-ink")}
        style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
      >
        <span className={cn("pl-4", line.isCancelled && "line-through text-ink-muted")}>
          {line.design}
        </span>
      </td>
      <td className="px-2.5 py-1.5" />
      <td className="px-2.5 py-1.5" />
      <td className="num px-2.5 py-1.5 text-right whitespace-nowrap text-ink-soft">
        {formatNumber(Number(line.qtyMtr))}
      </td>
      <td className="px-2.5 py-1.5" />
      <td className="px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-pill px-2 py-0.5 text-[11px] font-semibold",
              line.isCancelled
                ? "bg-inset text-ink-muted"
                : out
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning",
            )}
          >
            {line.isCancelled
              ? "Cancelled"
              : out
                ? "Dispatched"
                : "Not dispatched"}
          </span>
          {line.stages.map((s) => (
            <span
              key={s.stageKey}
              title={`${s.label}: ${s.state.replace("_", " ")}`}
              className={cn(
                "size-2 rounded-full",
                s.state === "done"
                  ? "bg-success"
                  : s.state === "overdue"
                    ? "bg-danger"
                    : s.state === "in_progress"
                      ? "bg-accent"
                      : "bg-line-strong",
              )}
            />
          ))}
        </div>
      </td>
    </tr>
  );
}
