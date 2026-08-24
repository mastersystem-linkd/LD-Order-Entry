// Roll an order's design lines up by QUALITY (fabric).
//
// The board used to list one row per design, so an order of 97 lines was 97
// rows and the operator had to read every one to answer "how far along is
// BROKERED C2?". Qualities are the unit people actually think in; the designs
// under one are its colours/matchings.
import type { OrderStatusGroup, OrderStatusRow } from "@/lib/order-status";

export const DISPATCH_STAGE = "dispatch";

// A design line is "dispatched" when its dispatch stage is done. That is the
// question the operator is really asking of each colour.
export function isDispatched(line: OrderStatusRow): boolean {
  return line.stages.some(
    (s) => s.stageKey === DISPATCH_STAGE && s.state === "done",
  );
}

export type QualityGroup = {
  key: string;
  orderId: string;
  orderNo: string;
  party: string;
  salesPerson: string | null;
  odDate: string;
  haste: string | null;
  challanNo: string | null;
  lotNo: string | null;
  fabric: string;
  /** The colours/matchings under this quality, in entry order. */
  lines: OrderStatusRow[];
  qtyTotal: number;
  valueTotal: number;
  dispatched: number;
  pending: number;
  cancelled: number;
  /** Every design under this quality is cancelled. */
  allCancelled: boolean;
};

// Group by (order, fabric), keeping the order the server already sorted lines
// into — newest order first, then the user's entry order within an order.
export function toQualityGroups(
  orders: OrderStatusGroup[],
): QualityGroup[] {
  const out: QualityGroup[] = [];
  const byKey = new Map<string, QualityGroup>();

  for (const o of orders) {
    for (const line of o.lines) {
      const key = `${o.orderId}|${line.fabric}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          key,
          orderId: o.orderId,
          orderNo: o.orderNo,
          party: o.party,
          salesPerson: o.salesPerson,
          odDate: o.odDate,
          haste: o.haste,
          challanNo: o.challanNo,
          lotNo: o.lotNo,
          fabric: line.fabric,
          lines: [],
          qtyTotal: 0,
          valueTotal: 0,
          dispatched: 0,
          pending: 0,
          cancelled: 0,
          allCancelled: false,
        };
        byKey.set(key, g);
        out.push(g);
      }
      g.lines.push(line);
      g.qtyTotal += Number(line.qtyMtr ?? 0);
      g.valueTotal += Number(line.lineTotal ?? 0);
      if (line.isCancelled) g.cancelled += 1;
      else if (isDispatched(line)) g.dispatched += 1;
      else g.pending += 1;
    }
  }

  for (const g of out) g.allCancelled = g.cancelled === g.lines.length;
  return out;
}

// Every design line across the groups, in the order they appear on screen —
// this is what the detail panel's ← / → walk through.
export function flattenLines(groups: QualityGroup[]): OrderStatusRow[] {
  return groups.flatMap((g) => g.lines);
}
