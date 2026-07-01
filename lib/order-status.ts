// Order Status module — shared types + the derived per-stage status logic
// (read-only; never stored). Used by the API routes and the board UI.

export type StageState = "done" | "in_progress" | "overdue" | "not_started";
export type OverallStatus = "completed" | "in_progress" | "overdue";

// Client-safe stage list for filter dropdowns (canonical keys + labels, §9).
export const STAGE_OPTIONS: { key: string; label: string }[] = [
  { key: "order_entry", label: "Order entry" },
  { key: "stock_checking", label: "Stock checking" },
  { key: "rolling_checking", label: "Rolling & checking" },
  { key: "challan", label: "Challan" },
  { key: "bill", label: "Bill" },
  { key: "dispatch", label: "Dispatch" },
  { key: "received_lr", label: "Received LR" },
];

// Per-stage dot colours (matches the board / §9).
export const STAGE_DOT: Record<string, string> = {
  order_entry: "bg-indigo-500",
  stock_checking: "bg-blue-500",
  rolling_checking: "bg-amber-500",
  challan: "bg-rose-500",
  bill: "bg-emerald-500",
  dispatch: "bg-violet-500",
  received_lr: "bg-cyan-500",
};

export type StageCell = {
  stageKey: string;
  label: string;
  state: StageState;
  date: string | null; // actual_at ISO, when done
  daysOverdue: number;
  // Order-level aggregate only (undefined for a single line): how many of the
  // order's lines have finished this stage, out of how many total.
  doneOf?: number;
  totalLines?: number;
};

export type OrderStatusRow = {
  lineId: string;
  orderId: string;
  orderNo: string;
  party: string;
  fabric: string;
  design: string;
  qtyMtr: string;
  salesPerson: string | null;
  odDate: string;
  stages: StageCell[];
  doneCount: number;
  currentStageKey: string | null;
  overall: OverallStatus;
};

// One row per order for the grouped board — an aggregate of its non-cancelled
// design lines. A stage counts as "done" only when EVERY line has finished it.
export type OrderStatusGroup = {
  orderId: string;
  orderNo: string;
  party: string;
  salesPerson: string | null;
  odDate: string;
  fabrics: string[];
  designCount: number;
  qtyTotal: number;
  stages: StageCell[];
  doneCount: number;
  currentStageKey: string | null;
  overall: OverallStatus;
  lines: OrderStatusRow[];
};

export type OrderStatusList = {
  rows: OrderStatusRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    total: number;
    inProgress: number;
    completed: number;
    overdue: number;
  };
};

export type OrderStatusDetailStage = {
  stageKey: string;
  label: string;
  plannedAt: string | null;
  actualAt: string | null;
  isDone: boolean;
  delayMinutes: number | null;
  state: StageState;
  daysOverdue: number;
};

export type OrderStatusDetail = {
  lineId: string;
  order: {
    id: string;
    orderNo: string;
    odDate: string;
    party: string;
    salesPerson: string | null;
    agent: string | null;
    haste: string | null;
    challanNo: string | null;
    lotNo: string | null;
    department: string | null;
    remarks: string | null;
  };
  line: { fabric: string; design: string; qtyMtr: string };
  stages: OrderStatusDetailStage[];
  doneCount: number;
  currentStageKey: string | null;
  overall: OverallStatus;
};

type RawStage = {
  stageKey: string;
  isDone: boolean;
  plannedAt: Date | string | null;
  actualAt: Date | string | null;
  delayMinutes: number | null;
};

const iso = (v: Date | string | null): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Derive per-stage state + overall for a single line (§2). `ordered` is the 7
// workflow stages by sort_order; `nowMs` is the comparison instant.
export function computeStages(
  rawStages: RawStage[],
  ordered: { key: string; label: string }[],
  nowMs: number,
) {
  const byKey = new Map(rawStages.map((s) => [s.stageKey, s]));

  let currentIdx = -1;
  for (let i = 0; i < ordered.length; i += 1) {
    const r = byKey.get(ordered[i].key);
    if (!r?.isDone) {
      currentIdx = i;
      break;
    }
  }

  const cells: StageCell[] = [];
  const detailStages: OrderStatusDetailStage[] = [];
  let doneCount = 0;

  ordered.forEach((s, i) => {
    const r = byKey.get(s.key);
    const isDone = !!r?.isDone;
    const planned = r?.plannedAt ? new Date(r.plannedAt) : null;
    const actual = r?.actualAt ? new Date(r.actualAt) : null;

    let state: StageState;
    let daysOverdue = 0;
    if (isDone) {
      state = "done";
      doneCount += 1;
    } else if (i === currentIdx) {
      if (planned && planned.getTime() < nowMs) {
        state = "overdue";
        daysOverdue = Math.floor((nowMs - planned.getTime()) / 86_400_000);
      } else {
        state = "in_progress";
      }
    } else {
      state = "not_started";
    }

    cells.push({
      stageKey: s.key,
      label: s.label,
      state,
      date: isDone ? iso(actual) : null,
      daysOverdue,
    });
    detailStages.push({
      stageKey: s.key,
      label: s.label,
      plannedAt: iso(planned),
      actualAt: iso(actual),
      isDone,
      delayMinutes: r?.delayMinutes ?? null,
      state,
      daysOverdue,
    });
  });

  const currentStageKey = currentIdx === -1 ? null : ordered[currentIdx].key;
  const overall: OverallStatus =
    currentIdx === -1
      ? "completed"
      : cells[currentIdx].state === "overdue"
        ? "overdue"
        : "in_progress";

  return { cells, detailStages, doneCount, currentStageKey, overall };
}

// Roll per-line rows up into one group per order for the grouped board.
// Per-stage aggregate (across the order's lines):
//   done        → every line finished it (date = latest actual)
//   overdue     → at least one line is currently overdue at it
//   in_progress → some finished / a line is working on it (doneOf/totalLines set)
//   not_started → no line has reached it
// Order overall: completed only if all lines completed; overdue if any line is.
export function aggregateOrderGroups(
  rows: OrderStatusRow[],
): OrderStatusGroup[] {
  const byOrder = new Map<string, OrderStatusRow[]>();
  for (const r of rows) {
    const arr = byOrder.get(r.orderId) ?? [];
    arr.push(r);
    byOrder.set(r.orderId, arr);
  }

  const groups: OrderStatusGroup[] = [];
  for (const lines of byOrder.values()) {
    const first = lines[0];
    const total = lines.length;
    const stageCount = first.stages.length;

    const stages: StageCell[] = [];
    for (let i = 0; i < stageCount; i += 1) {
      const cells = lines.map((l) => l.stages[i]);
      const base = cells[0];
      const doneCells = cells.filter((c) => c.state === "done");
      const doneN = doneCells.length;
      const anyOverdue = cells.some((c) => c.state === "overdue");
      const anyInProgress = cells.some((c) => c.state === "in_progress");

      let state: StageState;
      let date: string | null = null;
      let daysOverdue = 0;
      if (doneN === total) {
        state = "done";
        date = doneCells.reduce<string | null>(
          (acc, c) => (c.date && (acc == null || c.date > acc) ? c.date : acc),
          null,
        );
      } else if (anyOverdue) {
        state = "overdue";
        daysOverdue = Math.max(
          ...cells.map((c) => (c.state === "overdue" ? c.daysOverdue : 0)),
        );
      } else if (doneN > 0 || anyInProgress) {
        state = "in_progress";
      } else {
        state = "not_started";
      }

      stages.push({
        stageKey: base.stageKey,
        label: base.label,
        state,
        date,
        daysOverdue,
        doneOf: doneN,
        totalLines: total,
      });
    }

    const doneCount = stages.filter((s) => s.state === "done").length;
    const currentIdx = stages.findIndex((s) => s.state !== "done");
    const currentStageKey =
      currentIdx === -1 ? null : stages[currentIdx].stageKey;
    const overall: OverallStatus = lines.every(
      (l) => l.overall === "completed",
    )
      ? "completed"
      : lines.some((l) => l.overall === "overdue")
        ? "overdue"
        : "in_progress";

    groups.push({
      orderId: first.orderId,
      orderNo: first.orderNo,
      party: first.party,
      salesPerson: first.salesPerson,
      odDate: first.odDate,
      fabrics: [...new Set(lines.map((l) => l.fabric))],
      designCount: total,
      qtyTotal: lines.reduce((s, l) => s + Number(l.qtyMtr), 0),
      stages,
      doneCount,
      currentStageKey,
      overall,
      lines,
    });
  }

  return groups;
}
