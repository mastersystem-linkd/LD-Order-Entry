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
import { Pager } from "@/components/ui/pager";
import { HScroll } from "@/components/ui/h-scroll";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { TrackerDetail } from "./tracker-detail";
import { StageCell, STAGE_COLUMNS, STAGE_COL_WIDTH } from "./stage-cell";
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
const stickyHead = `${stickyBase} z-[5] bg-surface`;

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
  // Where the floating panel sits. null = its default corner; dragging pins it
  // to explicit viewport coordinates.
  const [panelPos, setPanelPos] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const dragOffset = React.useRef<{ dx: number; dy: number } | null>(null);
  // Briefly highlights the row the panel jumped to, so the eye can find it.
  const [flashId, setFlashId] = React.useState<string | null>(null);
  // The table fills whatever is left of the window. A hard-coded
  // `calc(100vh - Nrem)` cannot know how tall the header, the search bar (which
  // wraps on narrow screens) and the legend actually came out, so it always
  // leaves a band of dead space above the footer.
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [bodyMax, setBodyMax] = React.useState<number>();

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
  // The order-level row the line came from, for the whole-order totals.
  const selectedOrder = selected
    ? q.data?.groups.find((o) => o.orderId === selected.orderId)
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

  React.useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const fit = () => {
      // Measured against the document, not the viewport, so a page that happens
      // to be scrolled when this runs does not produce a short table.
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Room for the pagination strip inside the card, the app footer, and a
      // little breathing space beneath.
      const RESERVE = 108;
      setBodyMax(Math.max(240, window.innerHeight - top - RESERVE));
    };
    fit();
    window.addEventListener("resize", fit);
    // The toolbar above can change height (the search bar wraps, the legend
    // rewraps), which moves the card's top.
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, []);

  // Drag the panel by its title bar. It is switched to explicit coordinates on
  // the first move so it stops being anchored to the right edge.
  function startDrag(e: React.PointerEvent) {
    const el = panelRef.current;
    if (!el || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPanelPos({ x: r.left, y: r.top });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e: React.PointerEvent) {
    const off = dragOffset.current;
    const el = panelRef.current;
    if (!off || !el) return;
    const r = el.getBoundingClientRect();
    // Keep a grabbable strip on screen whichever way it is dragged.
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 48;
    setPanelPos({
      x: Math.min(Math.max(e.clientX - off.dx, 80 - r.width), maxX),
      y: Math.min(Math.max(e.clientY - off.dy, 8), maxY),
    });
  }
  function endDrag() {
    dragOffset.current = null;
  }

  // Bring the line the panel is describing into view: open its quality (a
  // colour row does not exist in the DOM while the group is collapsed) and
  // scroll to it. `centre` is for the explicit ⌖ button; following the panel
  // automatically uses "nearest", which moves the table as little as possible.
  const revealLine = React.useCallback(
    (line: OrderStatusRow, centre: boolean) => {
      const groupKey = `${line.orderId}|${line.fabric}`;
      setExpanded((prev) =>
        prev.has(groupKey) ? prev : new Set(prev).add(groupKey),
      );
      // Let the expansion render before measuring where to scroll.
      requestAnimationFrame(() => {
        const el =
          document.querySelector(`[data-line-id="${CSS.escape(line.lineId)}"]`) ??
          document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`);
        el?.scrollIntoView({
          behavior: "smooth",
          block: centre ? "center" : "nearest",
        });
      });
    },
    [],
  );

  // The table follows the panel. Walking through with Next used to leave the
  // panel describing a row that was collapsed and off-screen, so the operator
  // had to keep pressing ⌖ to catch up.
  React.useEffect(() => {
    if (!selected) return;
    revealLine(selected, false);
    // Only when the SELECTION moves — not on every re-render of the same line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The ⌖ button centres the row and flashes it, for when the eye has lost it.
  const goToRow = React.useCallback(() => {
    if (!selected) return;
    setFlashId(selected.lineId);
    revealLine(selected, true);
  }, [selected, revealLine]);

  // Clear the highlight once it has done its job.
  React.useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

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

      {/* What the Status column's colours mean — say it once, plainly. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="font-medium text-ink-muted">Status</span>
        <span className="font-semibold text-success">Completed</span>
        <span className="font-semibold text-warning">In progress</span>
        <span className="font-semibold text-danger">Not started</span>
        <span className="font-semibold text-ink-muted">Cancelled</span>
      </div>

      {/* The table keeps the whole width. The detail panel floats over its
          right-hand edge when a row is opened, so nothing is resized and
          whatever it covers is still reachable by scrolling the table. */}
      <div ref={cardRef} className="relative">
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
            <HScroll
              bodyClassName="overflow-auto"
              bodyStyle={{ maxHeight: bodyMax }}
            >
              <table className="w-full min-w-[1180px] text-left text-sm">
                <thead className="sticky top-0 z-[4] border-b border-line bg-surface">
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
                    {STAGE_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        title={c.full}
                        className="px-2 py-2 text-center whitespace-nowrap"
                        style={{ width: STAGE_COL_WIDTH, minWidth: STAGE_COL_WIDTH }}
                      >
                        {c.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <QualityRows
                      key={g.key}
                      group={g}
                      open={expanded.has(g.key)}
                      selectedId={selectedId}
                      flashId={flashId}
                      onToggle={() => toggleGroup(g.key)}
                      onSelect={setSelectedId}
                    />
                  ))}
                </tbody>
              </table>
            </HScroll>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span className="num text-xs text-ink-soft">
                {totalOrders} order{totalOrders === 1 ? "" : "s"}
              </span>
              <Pager
                page={safePage}
                totalPages={totalPages}
                onPage={setPage}
                busy={q.isFetching}
              />
            </div>
          ) : null}
        </Card>

        {hasSelection ? (
          <div
            ref={panelRef}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => setPanelPos(null)}
            style={
              panelPos
                ? { left: panelPos.x, top: panelPos.y }
                : { right: 24, top: 104 }
            }
            className="fixed z-30 flex max-h-[calc(100vh-8rem)] w-[min(94vw,520px)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface shadow-2xl"
          >
            <TrackerDetail
              line={selected}
              group={selectedGroup}
              order={selectedOrder}
              index={index}
              total={lines.length}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onSelectLine={setSelectedId}
              onClose={() => setSelectedId(null)}
              onDragStart={startDrag}
              onGoToRow={goToRow}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One quality, with a cell per stage showing how many of its designs are
// through it; opening it lists those designs (the colours) a row each.
function QualityRows({
  group,
  open,
  selectedId,
  flashId,
  onToggle,
  onSelect,
}: {
  group: QualityGroup;
  open: boolean;
  selectedId: string | null;
  flashId: string | null;
  onToggle: () => void;
  onSelect: (lineId: string) => void;
}) {
  const holdsSelection = group.lines.some((l) => l.lineId === selectedId);

  return (
    <>
      <tr
        data-group-key={group.key}
        onClick={() => onSelect(group.lines[0].lineId)}
        title={`${TONE_LABEL[group.tone]} — click for full details`}
        className={cn(
          "cursor-pointer border-b border-line transition-colors",
          // Background stays neutral; the STATUS is the text colour.
          holdsSelection ? "bg-accent/10" : "bg-surface hover:bg-inset",
          "text-ink",
        )}
      >
        <td
          className={cn(stickyCell, "num font-semibold", TONE_TEXT[group.tone])}
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
          className={cn(stickyCell, "truncate", TONE_TEXT[group.tone])}
          style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
          title={group.party}
        >
          {group.party}
        </td>
        <td
          className={cn(
            stickyCell,
            "truncate font-medium",
            TONE_TEXT[group.tone],
          )}
          style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
          title={group.fabric}
        >
          {group.fabric}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap">{formatDate(group.odDate)}</td>
        <td className="num px-2.5 py-2 text-right whitespace-nowrap">
          {group.lines.length}
        </td>
        <td
          className={cn(
            "num px-2.5 py-2 text-right font-medium whitespace-nowrap",
            TONE_TEXT[group.tone],
          )}
        >
          {formatNumber(group.qtyTotal)}
        </td>
        <td className="px-2.5 py-2 whitespace-nowrap">
          {group.salesPerson || "—"}
        </td>
        <td
          className={cn(
            "px-2.5 py-2 font-semibold whitespace-nowrap",
            TONE_TEXT[group.tone],
          )}
        >
          {TONE_LABEL[group.tone]}
        </td>
        {STAGE_COLUMNS.map((c) => (
          <td
            key={c.key}
            className="px-2 py-2 text-center"
            style={{ width: STAGE_COL_WIDTH, minWidth: STAGE_COL_WIDTH }}
          >
            <StageCell lines={group.lines} stageKey={c.key} label={c.full} />
          </td>
        ))}
      </tr>

      {open
        ? group.lines.map((l) => (
            <ColourRow
              key={l.lineId}
              line={l}
              selected={l.lineId === selectedId}
              flashed={l.lineId === flashId}
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
  flashed,
  onSelect,
}: {
  line: OrderStatusRow;
  selected: boolean;
  flashed?: boolean;
  onSelect: () => void;
}) {
  const tone = toneOfLines([line]);
  return (
    <tr
      data-line-id={line.lineId}
      onClick={onSelect}
      title={`${TONE_LABEL[tone]} — click for full details`}
      className={cn(
        "cursor-pointer border-b border-line transition-colors",
        flashed
          ? "bg-accent/25"
          : selected
            ? "bg-accent/10"
            : "bg-surface-2 hover:bg-inset",
        "text-ink-soft",
      )}
    >
      <td className={stickyCell} style={{ left: 0, width: W_ORDER, minWidth: W_ORDER }} />
      <td
        className={stickyCell}
        style={{ left: L_PARTY, width: W_PARTY, minWidth: W_PARTY }}
      />
      <td
        className={cn(stickyCell, "num truncate font-medium", TONE_TEXT[tone])}
        style={{ left: L_QUALITY, width: W_QUALITY, minWidth: W_QUALITY }}
        title={`Design ${line.design}`}
      >
        <span className={cn("pl-5", line.isCancelled && "line-through")}>
          {line.design}
        </span>
      </td>
      <td className="px-2.5 py-1.5" />
      <td className="px-2.5 py-1.5" />
      <td
        className={cn(
          "num px-2.5 py-1.5 text-right font-medium whitespace-nowrap",
          TONE_TEXT[tone],
        )}
      >
        {formatNumber(Number(line.qtyMtr))}
      </td>
      <td className="px-2.5 py-1.5" />
      <td
        className={cn(
          "px-2.5 py-1.5 font-semibold whitespace-nowrap",
          TONE_TEXT[tone],
        )}
      >
        {TONE_LABEL[tone]}
      </td>
      {STAGE_COLUMNS.map((c) => (
        <td
          key={c.key}
          className="px-2 py-1.5 text-center"
          style={{ width: STAGE_COL_WIDTH, minWidth: STAGE_COL_WIDTH }}
        >
          <StageCell lines={[line]} stageKey={c.key} label={c.full} />
        </td>
      ))}
    </tr>
  );
}
