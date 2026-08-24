"use client";

import * as React from "react";

import { formatNumber } from "@/lib/orders";
import { monthLabel, monthRange, type MonthKey } from "@/lib/months";
import type { MonthlyReport as Report } from "@/lib/monthly-report";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Td, Th, THead } from "@/components/ui/table";

// Counts are whole numbers; lib/orders' formatNumber always shows 2 decimals,
// which is right for qty and money and wrong for "74 orders".
const int = (n: number) => new Intl.NumberFormat("en-IN").format(n);

// "2026-05-17" → "17 May 2026". The shared formatDate omits the year, which is
// exactly what a "since when" line needs to keep.
function fullDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

// Every month the order book covers, newest first — the answer to "when did we
// start, and what has each month looked like since?". Clicking a row points the
// whole Dashboard at that month.
export function MonthlyReport({
  report,
  loading,
  selectedMonth,
  onPickMonth,
}: {
  report?: Report;
  loading?: boolean;
  selectedMonth: MonthKey | null;
  onPickMonth: (range: { from: string; to: string }) => void;
}) {
  // Stable identity so the totals below aren't recomputed on every render.
  const months = React.useMemo(() => report?.months ?? [], [report]);
  const since = report?.since;

  const totals = React.useMemo(
    () =>
      months.reduce(
        (t, m) => ({
          orders: t.orders + m.orders,
          designs: t.designs + m.designs,
          cancelledDesigns: t.cancelledDesigns + m.cancelledDesigns,
          qtyMtr: t.qtyMtr + m.qtyMtr,
          value: t.value + m.value,
        }),
        { orders: 0, designs: 0, cancelledDesigns: 0, qtyMtr: 0, value: 0 },
      ),
    [months],
  );

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Monthly report</CardTitle>
          <p className="mt-0.5 text-xs text-ink-muted">
            {since?.firstOrderDate ? (
              <>
                Oldest order dated{" "}
                <span className="font-medium text-ink-soft">
                  {fullDate(since.firstOrderDate)}
                </span>
                {since.firstEnteredAt ? (
                  <>
                    {" · system in use since "}
                    <span className="font-medium text-ink-soft">
                      {fullDate(since.firstEnteredAt.slice(0, 10))}
                    </span>
                  </>
                ) : null}
                {" · "}
                <span className="num">{int(since.ordersTotal)}</span> orders in
                total
              </>
            ) : loading ? (
              "Loading…"
            ) : (
              "No orders yet."
            )}
          </p>
        </div>
        {selectedMonth ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPickMonth({ from: "", to: "" })}
          >
            Clear month
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {months.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            {loading ? "Loading…" : "Nothing to report yet."}
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[820px] text-left text-sm text-ink">
              <THead>
                <tr>
                  <Th className="w-full">Month</Th>
                  <Th className="text-right">Orders</Th>
                  <Th className="text-right">Designs</Th>
                  <Th className="text-right">Qty (mtr)</Th>
                  <Th className="text-right">Value</Th>
                  <Th className="text-right">Completed</Th>
                  <Th className="text-right">In progress</Th>
                  <Th className="text-right">Pending</Th>
                  <Th className="text-right">Cancelled</Th>
                </tr>
              </THead>
              <tbody>
                {months.map((m) => {
                  const isSelected = selectedMonth === m.month;
                  const empty = m.orders === 0;
                  return (
                    <tr
                      key={m.month}
                      onClick={() => onPickMonth(monthRange(m.month))}
                      className={cn(
                        "cursor-pointer border-b border-line transition-colors last:border-0",
                        isSelected ? "bg-accent/5" : "hover:bg-inset",
                      )}
                    >
                      <Td className="font-medium">
                        <span className={empty ? "text-ink-muted" : "text-ink"}>
                          {monthLabel(m.month)}
                        </span>
                        {isSelected ? (
                          <span className="ml-2 rounded-pill bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Showing
                          </span>
                        ) : null}
                        {empty ? (
                          <span className="ml-2 text-[11px] text-ink-muted">
                            no orders
                          </span>
                        ) : null}
                      </Td>
                      <Td
                        className={cn(
                          "num text-right font-medium",
                          empty ? "text-ink-muted" : "text-ink",
                        )}
                      >
                        {int(m.orders)}
                      </Td>
                      <Td className="num text-right text-ink-soft">
                        {int(m.designs)}
                        {m.cancelledDesigns ? (
                          <span
                            className="ml-1 text-[11px] text-danger"
                            title={`${m.cancelledDesigns} cancelled`}
                          >
                            +{int(m.cancelledDesigns)}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="num text-right text-ink-soft">
                        {formatNumber(m.qtyMtr)}
                      </Td>
                      <Td className="num text-right text-ink-soft">
                        ₹{formatNumber(m.value)}
                      </Td>
                      <Td
                        className={cn(
                          "num text-right",
                          m.completedOrders ? "text-success" : "text-ink-muted",
                        )}
                      >
                        {int(m.completedOrders)}
                      </Td>
                      <Td
                        className={cn(
                          "num text-right",
                          m.partiallyOrders ? "text-warning" : "text-ink-muted",
                        )}
                      >
                        {int(m.partiallyOrders)}
                      </Td>
                      <Td className="num text-right text-ink-soft">
                        {int(m.pendingOrders)}
                      </Td>
                      <Td
                        className={cn(
                          "num text-right",
                          m.cancelledOrders ? "text-danger" : "text-ink-muted",
                        )}
                      >
                        {int(m.cancelledOrders)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong">
                  <Td className="text-xs font-medium text-ink-soft">
                    All months
                  </Td>
                  <Td className="num text-right font-semibold">
                    {int(totals.orders)}
                  </Td>
                  <Td className="num text-right font-semibold">
                    {int(totals.designs)}
                  </Td>
                  <Td className="num text-right font-semibold">
                    {formatNumber(totals.qtyMtr)}
                  </Td>
                  <Td className="num text-right font-semibold">
                    ₹{formatNumber(totals.value)}
                  </Td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
