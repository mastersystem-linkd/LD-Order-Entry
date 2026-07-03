"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, PencilIcon, RotateCcwIcon, RouteIcon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderDetail } from "@/lib/orders";
import { hasCap, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const queryClient = useQueryClient();
  // Pending cancel confirmation — a single design (lineId) or the whole order.
  const [confirmCancel, setConfirmCancel] = React.useState<{
    lineId?: string;
    label: string;
  } | null>(null);

  const detail = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderDetail>(`/api/orders/${orderId}`),
  });

  const cancel = useMutation({
    mutationFn: (vars: { lineId?: string; cancelled: boolean }) =>
      apiSend(`/api/orders/${orderId}/cancel`, "PATCH", {
        line_id: vars.lineId ?? null,
        cancelled: vars.cancelled,
      }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.lineId
          ? vars.cancelled
            ? "Design cancelled."
            : "Design restored."
          : vars.cancelled
            ? "Order cancelled."
            : "Order restored.",
      );
      setConfirmCancel(null);
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order-status"] });
      queryClient.invalidateQueries({ queryKey: ["tracking", orderId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmCancel(null);
    },
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
  const orderCancelled = d.is_order_cancelled;

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
            <Button
              variant="outline"
              render={<Link href={`/tracking/${orderId}`} />}
            >
              <RouteIcon /> Track
            </Button>
          ) : null}
          {canEdit ? (
            <Button render={<Link href={`/orders/${orderId}/edit`} />}>
              <PencilIcon /> Edit
            </Button>
          ) : null}
          {canEdit ? (
            orderCancelled ? (
              <Button
                variant="outline"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ cancelled: false })}
              >
                <RotateCcwIcon /> Restore order
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                disabled={cancel.isPending}
                onClick={() =>
                  setConfirmCancel({ label: `order ${d.order.order_no}` })
                }
              >
                <BanIcon /> Cancel order
              </Button>
            )
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
                  {canEdit ? <Th className="text-right" /> : null}
                </tr>
              </THead>
              <tbody>
                {d.lines.map((l) => {
                  const struck = l.is_cancelled
                    ? "text-ink-muted line-through"
                    : "";
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-line last:border-0"
                    >
                      <td className={cn("px-3 py-2 min-w-[160px]", struck)}>
                        {l.quality}
                      </td>
                      <td className={cn("px-3 py-2", struck)}>{l.design_no}</td>
                      <td className={cn("num px-3 py-2 text-right", struck)}>
                        {formatNumber(Number(l.qty_mtr))}
                      </td>
                      <td className={cn("num px-3 py-2 text-right", struck)}>
                        {l.rate == null ? "—" : formatNumber(Number(l.rate))}
                      </td>
                      <td className={cn("num px-3 py-2 text-right", struck)}>
                        {l.line_total == null
                          ? "—"
                          : `₹${formatNumber(Number(l.line_total))}`}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={
                            l.is_cancelled ? "CANCELLED" : l.operations_status
                          }
                        />
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right">
                          {l.is_cancelled ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Restore design"
                              title="Restore design"
                              disabled={cancel.isPending}
                              onClick={() =>
                                cancel.mutate({
                                  lineId: l.id,
                                  cancelled: false,
                                })
                              }
                            >
                              <RotateCcwIcon />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Cancel design"
                              title="Cancel design"
                              className="text-danger hover:bg-danger/10 hover:text-danger"
                              disabled={cancel.isPending}
                              onClick={() =>
                                setConfirmCancel({
                                  lineId: l.id,
                                  label: `${l.quality} · ${l.design_no}`,
                                })
                              }
                            >
                              <BanIcon />
                            </Button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
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
                  {canEdit ? <td className="px-3 py-2" /> : null}
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cancel confirmation (restore is immediate). */}
      <Dialog
        open={!!confirmCancel}
        onOpenChange={(open) => {
          if (!open) setConfirmCancel(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmCancel?.lineId ? "Cancel design?" : "Cancel order?"}
            </DialogTitle>
            <DialogDescription>
              Cancel{" "}
              <span className="font-medium text-ink">
                {confirmCancel?.label}
              </span>
              ? It stays on record (struck through) and is excluded from totals
              and operations. You can restore it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCancel(null)}
              disabled={cancel.isPending}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() =>
                confirmCancel &&
                cancel.mutate({
                  lineId: confirmCancel.lineId,
                  cancelled: true,
                })
              }
            >
              {cancel.isPending ? <Spinner /> : <BanIcon />}{" "}
              {confirmCancel?.lineId ? "Cancel design" : "Cancel order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
