"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BanIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderDetail } from "@/lib/orders";
import { hasCap, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";

// Per-design cancel (reversible strike-through) + delete (soft-delete → Trash).
// Both invalidate every view a design touches. Used by the expandable Orders
// table (desktop) and the mobile order popup.
export function useDesignActions(orderId: string) {
  const qc = useQueryClient();
  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["order", orderId] });
    qc.invalidateQueries({ queryKey: ["order-status"] });
    qc.invalidateQueries({ queryKey: ["tracking", orderId] });
    qc.invalidateQueries({ queryKey: ["trash"] });
  }, [qc, orderId]);

  const cancelDesign = useMutation({
    mutationFn: (v: { lineId: string; cancelled: boolean }) =>
      apiSend(`/api/orders/${orderId}/cancel`, "PATCH", {
        line_id: v.lineId,
        cancelled: v.cancelled,
      }),
    onSuccess: (_r, v) => {
      toast.success(v.cancelled ? "Design cancelled." : "Design restored.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDesign = useMutation({
    mutationFn: (lineId: string) =>
      apiSend(`/api/orders/${orderId}/delete`, "PATCH", {
        line_id: lineId,
        deleted: true,
      }),
    onSuccess: () => {
      toast.success("Design deleted — moved to Trash.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { cancelDesign, deleteDesign };
}

function useOrderDesigns(orderId: string, enabled = true) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderDetail>(`/api/orders/${orderId}`),
    enabled,
  });
}

// Expanded panel under an order row (desktop). A self-contained mini-table so it
// doesn't have to line up with the parent's 13 columns.
export function OrderDesignsPanel({
  orderId,
  caps,
}: {
  orderId: string;
  caps: Capability[];
}) {
  const canEdit = hasCap(caps, "orders.edit");
  const detail = useOrderDesigns(orderId);
  const { cancelDesign, deleteDesign } = useDesignActions(orderId);
  const busy = cancelDesign.isPending || deleteDesign.isPending;

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 px-6 py-4 text-sm text-ink-muted">
        <Spinner /> Loading designs…
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="px-6 py-4 text-sm text-danger">
        {(detail.error as Error)?.message ?? "Failed to load designs."}
      </div>
    );
  }

  const lines = detail.data.lines;
  return (
    <div className="px-6 py-3">
      <div className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-muted uppercase">
        Designs ({lines.length})
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Fabric</th>
              <th className="px-3 py-1.5 font-medium">Design no</th>
              <th className="px-3 py-1.5 text-right font-medium">Qty</th>
              <th className="px-3 py-1.5 text-right font-medium">Rate</th>
              <th className="px-3 py-1.5 text-right font-medium">Line total</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              {canEdit ? (
                <th className="px-3 py-1.5 text-right font-medium">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const struck = l.is_cancelled
                ? "text-ink-muted line-through"
                : "";
              return (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className={cn("px-3 py-2", struck)}>{l.quality}</td>
                  <td className={cn("num px-3 py-2", struck)}>{l.design_no}</td>
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
                      status={l.is_cancelled ? "CANCELLED" : l.operations_status}
                    />
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {l.is_cancelled ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Restore design"
                            title="Restore design"
                            disabled={busy}
                            onClick={() =>
                              cancelDesign.mutate({
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
                            title="Cancel design (strike through)"
                            className="text-warning hover:bg-warning/10 hover:text-warning"
                            disabled={busy}
                            onClick={() =>
                              cancelDesign.mutate({
                                lineId: l.id,
                                cancelled: true,
                              })
                            }
                          >
                            <BanIcon />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete design"
                          title="Delete design (move to Trash)"
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          disabled={busy}
                          onClick={() => deleteDesign.mutate(l.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted">
        Cancel strikes a design through (reversible). Delete moves it to Trash
        (restorable). Deleting every design removes the order.
      </p>
    </div>
  );
}

// Vertical designs list for the mobile order popup.
export function OrderDesignsList({
  orderId,
  caps,
}: {
  orderId: string;
  caps: Capability[];
}) {
  const canEdit = hasCap(caps, "orders.edit");
  const detail = useOrderDesigns(orderId);
  const { cancelDesign, deleteDesign } = useDesignActions(orderId);
  const busy = cancelDesign.isPending || deleteDesign.isPending;

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-ink-muted">
        <Spinner /> Loading designs…
      </div>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <div className="py-3 text-sm text-danger">
        {(detail.error as Error)?.message ?? "Failed to load designs."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {detail.data.lines.map((l) => {
        const struck = l.is_cancelled ? "text-ink-muted line-through" : "";
        return (
          <div
            key={l.id}
            className="flex items-center gap-2 rounded-field border border-line bg-surface p-2"
          >
            <div className="min-w-0 flex-1">
              <div className={cn("truncate text-sm font-medium text-ink", struck)}>
                {l.quality} · {l.design_no}
              </div>
              <div className="num text-[12px] text-ink-muted">
                {formatNumber(Number(l.qty_mtr))} mtr
                {l.line_total == null
                  ? ""
                  : ` · ₹${formatNumber(Number(l.line_total))}`}
              </div>
            </div>
            <StatusBadge
              status={l.is_cancelled ? "CANCELLED" : l.operations_status}
            />
            {canEdit ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {l.is_cancelled ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Restore design"
                    title="Restore design"
                    disabled={busy}
                    onClick={() =>
                      cancelDesign.mutate({ lineId: l.id, cancelled: false })
                    }
                  >
                    <RotateCcwIcon />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel design"
                    title="Cancel design"
                    className="text-warning hover:bg-warning/10 hover:text-warning"
                    disabled={busy}
                    onClick={() =>
                      cancelDesign.mutate({ lineId: l.id, cancelled: true })
                    }
                  >
                    <BanIcon />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete design"
                  title="Delete design (move to Trash)"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  disabled={busy}
                  onClick={() => deleteDesign.mutate(l.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
