"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PencilIcon, RouteIcon } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { formatNumber, type OrderDetail } from "@/lib/orders";
import type { Role } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";

export function OrderDetailView({
  orderId,
  role,
}: {
  orderId: string;
  role: Role;
}) {
  const canEdit = role === "ADMIN" || role === "SALES";
  const detail = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderDetail>(`/api/orders/${orderId}`),
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{d.order.order_no}</h2>
          <StatusBadge status={d.operations_status} />
        </div>
        <div className="flex gap-2">
          {role !== "SALES" ? (
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
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Fabric</th>
                  <th className="px-4 py-2.5 font-medium">Design no</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Line total
                  </th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5">{l.quality}</td>
                    <td className="px-4 py-2.5">{l.design_no}</td>
                    <td className="num px-4 py-2.5 text-right">
                      {formatNumber(Number(l.qty_mtr))}
                    </td>
                    <td className="num px-4 py-2.5 text-right">
                      {l.rate == null ? "—" : formatNumber(Number(l.rate))}
                    </td>
                    <td className="num px-4 py-2.5 text-right">
                      {l.line_total == null
                        ? "—"
                        : `₹${formatNumber(Number(l.line_total))}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={l.operations_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-inset font-medium">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Grand total
                  </td>
                  <td className="num px-4 py-2.5 text-right">
                    {formatNumber(d.qty_total)}
                  </td>
                  <td className="px-4 py-2.5" />
                  <td className="num px-4 py-2.5 text-right">
                    ₹{formatNumber(d.grand_total)}
                  </td>
                  <td className="px-4 py-2.5" />
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
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
