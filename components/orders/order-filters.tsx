"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMonthlyReport } from "@/components/orders/use-months";
import { monthLabel, monthOfRange, monthRange } from "@/lib/months";

// Shared order-list filters used by the Orders, Operations and Order Status
// screens. The keys map 1:1 to the query params accepted by /api/orders and
// /api/order-status (order_no, challan_no, lot_no, haste, from, to).
export type OrderFilterState = {
  orderNo: string;
  challanNo: string;
  lotNo: string;
  haste: string;
  from: string; // YYYY-MM-DD (order date, inclusive lower bound)
  to: string; // YYYY-MM-DD (order date, inclusive upper bound)
};

export const EMPTY_ORDER_FILTERS: OrderFilterState = {
  orderNo: "",
  challanNo: "",
  lotNo: "",
  haste: "",
  from: "",
  to: "",
};

export function hasActiveOrderFilters(f: OrderFilterState): boolean {
  return !!(f.orderNo || f.challanNo || f.lotNo || f.haste || f.from || f.to);
}

// Append the active filters onto an existing URLSearchParams.
export function appendOrderFilterParams(
  p: URLSearchParams,
  f: OrderFilterState,
): void {
  if (f.orderNo.trim()) p.set("order_no", f.orderNo.trim());
  if (f.challanNo.trim()) p.set("challan_no", f.challanNo.trim());
  if (f.lotNo.trim()) p.set("lot_no", f.lotNo.trim());
  if (f.haste.trim()) p.set("haste", f.haste.trim());
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
}

const fieldCls = "flex flex-col gap-1 text-[11px] font-medium text-ink-soft";
const selectCls =
  "h-9 w-full rounded-field border border-line-strong bg-surface px-2 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

// Controlled filter panel — fires onChange on every keystroke; each screen
// debounces before it hits the query.
export function OrderFilters({
  value,
  onChange,
  onClear,
  showClear = true,
}: {
  value: OrderFilterState;
  onChange: (next: OrderFilterState) => void;
  onClear: () => void;
  // Screens that already render their own Clear (e.g. Order Status) hide it.
  showClear?: boolean;
}) {
  const set = (patch: Partial<OrderFilterState>) =>
    onChange({ ...value, ...patch });

  // Every month the order book covers, newest first. Picking one just fills in
  // From/To, so the month select and the date inputs can never disagree — and
  // a hand-typed range that happens to be a whole month shows as that month.
  const months = useMonthlyReport().data?.months ?? [];
  const selectedMonth = monthOfRange(value.from, value.to);

  return (
    <div className="flex flex-col gap-3 rounded-field border border-line bg-surface-2 p-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <label className={fieldCls}>
          Order no
          <Input
            value={value.orderNo}
            onChange={(e) => set({ orderNo: e.target.value })}
            placeholder="Order no"
            className="h-9 w-full"
          />
        </label>
        <label className={fieldCls}>
          Challan no
          <Input
            value={value.challanNo}
            onChange={(e) => set({ challanNo: e.target.value })}
            placeholder="Challan"
            className="h-9 w-full"
          />
        </label>
        <label className={fieldCls}>
          Lot no
          <Input
            value={value.lotNo}
            onChange={(e) => set({ lotNo: e.target.value })}
            placeholder="Lot"
            className="h-9 w-full"
          />
        </label>
        <label className={fieldCls}>
          Haste
          <Input
            value={value.haste}
            onChange={(e) => set({ haste: e.target.value })}
            placeholder="Haste"
            className="h-9 w-full"
          />
        </label>
        <label className={fieldCls}>
          Month
          <select
            className={selectCls}
            value={selectedMonth ?? ""}
            onChange={(e) => {
              const key = e.target.value;
              // "All months" clears the dates; a month sets the whole range, so
              // the From/To inputs stay the single source of truth.
              set(key ? monthRange(key) : { from: "", to: "" });
            }}
          >
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m.month} value={m.month}>
                {monthLabel(m.month)}
                {m.orders ? ` (${m.orders})` : " — none"}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldCls}>
          From date
          <Input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            className="num h-9 w-full"
          />
        </label>
        <label className={fieldCls}>
          To date
          <Input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            className="num h-9 w-full"
          />
        </label>
      </div>
      {showClear && hasActiveOrderFilters(value) ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClear}>
            <XIcon /> Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
