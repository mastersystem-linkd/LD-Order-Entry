"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PencilIcon, RouteIcon } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { formatNumber, type OrderDetail } from "@/lib/orders";
import { hasCap, type Capability } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Th, THead } from "@/components/ui/table";

export function OrderDetailView({
  orderId,
  caps,
}: {
  orderId: string;
  caps: Capability[];
}) {
  const canEdit = hasCap(caps, "orders.edit");
  const canTrack = hasCap(caps, "operations.view");
  const detail = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderDetail>(`/api/orders/${orderId}`),
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> Loading order…
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-danger">
          {(detail.error as Error)?.message ?? "Order not found."}
        </CardContent>
      </Card>
    );
  }

  const d = detail.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-ink break-words">
            {d.order.order_no}
          </h2>
          <StatusBadge status={d.operations_status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {canTrack ? (
            <Button variant="outline" render={<Link href={`/tracking/${orderId}`} />}>
              <RouteIcon /> Track
            </Button>
          ) : null}
          {canEdit ? (
            <Button render={<Link href={`/orders/${orderId}/edit`} />}>
              <PencilIcon /> Edit
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <Detail term="Order date" value={d.order.order_date} />
          <Detail term="Party" value={d.order.party_name} />
          <Detail term="Sales person" value={d.order.sales_person ?? "—"} />
          <Detail term="Agent" value={d.order.agent ?? "—"} />
          <Detail term="Haste" value={d.order.haste ?? "—"} />
          <Detail term="Transport" value={d.order.transport ?? "—"} />
          <Detail term="Challan no" value={d.order.challan_no ?? "—"} />
          <Detail term="Lot no" value={d.order.lot_no ?? "—"} />
          <Detail term="Department" value={d.order.department ?? "—"} />
          {d.order.remarks ? (
            <Detail
              term="Remarks"
              value={d.order.remarks}
              className="col-span-2"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <THead>
                <tr>
                  <Th>Fabric</Th>
                  <Th>Design no</Th>
                  <Th className="text-right">Qty</Th>
                  <Th className="text-right">Rate</Th>
                  <Th className="text-right">Line total</Th>
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {d.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-3 py-2 min-w-[160px]">{l.quality}</td>
                    <td className="px-3 py-2">{l.design_no}</td>
                    <td className="num px-3 py-2 text-right">
                      {formatNumber(Number(l.qty_mtr))}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {l.rate == null ? "—" : formatNumber(Number(l.rate))}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {l.line_total == null
                        ? "—"
                        : `₹${formatNumber(Number(l.line_total))}`}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={l.operations_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-inset font-medium">
                  <td className="px-3 py-2" colSpan={2}>
                    Grand total
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {formatNumber(d.qty_total)}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="num px-3 py-2 text-right">
                    ₹{formatNumber(d.grand_total)}
                  </td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({
  term,
  value,
  className,
}: {
  term: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-ink-muted">{term}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}
