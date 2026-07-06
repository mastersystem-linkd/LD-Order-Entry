"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  type TrashDesign,
  type TrashList,
  type TrashOrder,
} from "@/lib/orders";
import { hasCap, type Capability } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Th, THead } from "@/components/ui/table";

// A pending permanent-purge confirmation (order or single design).
type Purge =
  | { kind: "order"; id: string; label: string }
  | { kind: "design"; orderId: string; lineId: string; label: string };

export function TrashView({ caps }: { caps: Capability[] }) {
  const canEdit = hasCap(caps, "orders.edit");
  const qc = useQueryClient();
  const [purge, setPurge] = React.useState<Purge | null>(null);

  const q = useQuery({
    queryKey: ["trash"],
    queryFn: () => apiGet<TrashList>("/api/trash"),
  });

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["trash"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["order-status"] });
  }, [qc]);

  const restore = useMutation({
    mutationFn: (v: { orderId: string; lineId: string | null }) =>
      apiSend(`/api/orders/${v.orderId}/delete`, "PATCH", {
        line_id: v.lineId,
        deleted: false,
      }),
    onSuccess: (_r, v) => {
      toast.success(v.lineId ? "Design restored." : "Order restored.");
      qc.invalidateQueries({ queryKey: ["order", v.orderId] });
      qc.invalidateQueries({ queryKey: ["tracking", v.orderId] });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const purgeMut = useMutation({
    mutationFn: (p: Purge) =>
      p.kind === "order"
        ? apiSend(`/api/orders/${p.id}`, "DELETE")
        : apiSend(`/api/orders/${p.orderId}/lines/${p.lineId}`, "DELETE"),
    onSuccess: (_r, p) => {
      toast.success(
        p.kind === "order"
          ? "Order permanently deleted."
          : "Design permanently deleted.",
      );
      setPurge(null);
      invalidate();
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setPurge(null);
    },
  });

  const busy = restore.isPending || purgeMut.isPending;
  const orders = q.data?.orders ?? [];
  const designs = q.data?.designs ?? [];
  const empty = orders.length === 0 && designs.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Deleted orders and designs are kept here. Restore them, or delete them
          permanently. Cancelled (struck-through) designs are not here — they
          stay on their order.
        </p>
        <Button
          variant="outline"
          size="icon"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          aria-label="Refresh"
          title="Refresh"
          className="shrink-0"
        >
          {q.isFetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>

      {q.isLoading ? (
        <Card data-size="sm">
          <CardContent className="flex items-center gap-2 py-10 text-sm text-ink-soft">
            <Spinner /> Loading trash…
          </CardContent>
        </Card>
      ) : q.isError ? (
        <Card data-size="sm">
          <CardContent className="py-10 text-sm text-danger">
            {(q.error as Error)?.message ?? "Failed to load trash."}
          </CardContent>
        </Card>
      ) : empty ? (
        <Card data-size="sm">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-sm text-ink-muted">
            <TrashIcon className="size-7 text-ink-muted" />
            Trash is empty. Deleted orders and designs will appear here.
          </CardContent>
        </Card>
      ) : (
        <>
          {orders.length > 0 ? (
            <Section title="Deleted orders" count={orders.length}>
              {/* Mobile: stacked cards */}
              <div className="flex flex-col gap-2 px-3 pb-1 lg:hidden">
                {orders.map((o) => (
                  <TrashOrderCard
                    key={o.id}
                    o={o}
                    canEdit={canEdit}
                    busy={busy}
                    onRestore={() =>
                      restore.mutate({ orderId: o.id, lineId: null })
                    }
                    onPurge={() =>
                      setPurge({
                        kind: "order",
                        id: o.id,
                        label: `order ${o.order_no}`,
                      })
                    }
                  />
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <THead>
                  <tr>
                    <Th>Order no</Th>
                    <Th>Party</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Designs</Th>
                    <Th className="text-right">Total qty</Th>
                    <Th className="text-right">Total amount</Th>
                    <Th>Deleted</Th>
                    {canEdit ? <Th className="text-right">Actions</Th> : null}
                  </tr>
                </THead>
                <tbody>
                  {orders.map((o) => (
                    <TrashOrderRow
                      key={o.id}
                      o={o}
                      canEdit={canEdit}
                      busy={busy}
                      onRestore={() =>
                        restore.mutate({ orderId: o.id, lineId: null })
                      }
                      onPurge={() =>
                        setPurge({
                          kind: "order",
                          id: o.id,
                          label: `order ${o.order_no}`,
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
              </div>
            </Section>
          ) : null}

          {designs.length > 0 ? (
            <Section title="Deleted designs" count={designs.length}>
              {/* Mobile: stacked cards */}
              <div className="flex flex-col gap-2 px-3 pb-1 lg:hidden">
                {designs.map((d) => (
                  <TrashDesignCard
                    key={d.line_id}
                    d={d}
                    canEdit={canEdit}
                    busy={busy}
                    onRestore={() =>
                      restore.mutate({ orderId: d.order_id, lineId: d.line_id })
                    }
                    onPurge={() =>
                      setPurge({
                        kind: "design",
                        orderId: d.order_id,
                        lineId: d.line_id,
                        label: `${d.quality} · ${d.design_no} (${d.order_no})`,
                      })
                    }
                  />
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <THead>
                  <tr>
                    <Th>Order no</Th>
                    <Th>Party</Th>
                    <Th>Fabric</Th>
                    <Th>Design no</Th>
                    <Th className="text-right">Qty</Th>
                    <Th>Deleted</Th>
                    {canEdit ? <Th className="text-right">Actions</Th> : null}
                  </tr>
                </THead>
                <tbody>
                  {designs.map((d) => (
                    <TrashDesignRow
                      key={d.line_id}
                      d={d}
                      canEdit={canEdit}
                      busy={busy}
                      onRestore={() =>
                        restore.mutate({
                          orderId: d.order_id,
                          lineId: d.line_id,
                        })
                      }
                      onPurge={() =>
                        setPurge({
                          kind: "design",
                          orderId: d.order_id,
                          lineId: d.line_id,
                          label: `${d.quality} · ${d.design_no} (${d.order_no})`,
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
              </div>
            </Section>
          ) : null}
        </>
      )}

      {/* Permanent-delete confirmation */}
      <Dialog
        open={!!purge}
        onOpenChange={(open) => {
          if (!open) setPurge(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete permanently?</DialogTitle>
            <DialogDescription>
              Permanently delete{" "}
              <span className="font-medium text-ink">{purge?.label}</span>? This
              removes it and its stage progress for good and{" "}
              <span className="font-medium text-ink">cannot be undone</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurge(null)}
              disabled={purgeMut.isPending}
            >
              Keep
            </Button>
            <Button
              variant="destructive"
              onClick={() => purge && purgeMut.mutate(purge)}
              disabled={purgeMut.isPending}
            >
              {purgeMut.isPending ? (
                <>
                  <Spinner /> Deleting…
                </>
              ) : (
                <>
                  <Trash2Icon /> Delete permanently
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card data-size="sm">
      <CardContent className="px-0">
        <div className="flex items-center gap-2 px-4 pb-2">
          <h2 className="font-display text-[15px] font-semibold text-ink">
            {title}
          </h2>
          <span className="num rounded-pill bg-inset px-2 py-0.5 text-[11px] font-medium text-ink-soft">
            {count}
          </span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function TrashOrderRow({
  o,
  canEdit,
  busy,
  onRestore,
  onPurge,
}: {
  o: TrashOrder;
  canEdit: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <Td className="font-medium">
        <Link
          href={`/orders/${o.id}`}
          className="num hover:text-accent hover:underline"
        >
          {o.order_no}
        </Link>
      </Td>
      <Td>{o.party_name}</Td>
      <Td className="num whitespace-nowrap text-ink-soft">
        {formatDate(o.order_date)}
      </Td>
      <Td className="num text-right">{o.design_count}</Td>
      <Td className="num text-right">{formatNumber(o.qty_total)}</Td>
      <Td className="num text-right">₹{formatNumber(o.grand_total)}</Td>
      <Td className="num whitespace-nowrap text-ink-soft">
        {formatDateTime(String(o.deleted_at))}
      </Td>
      {canEdit ? (
        <Td>
          <RowActions busy={busy} onRestore={onRestore} onPurge={onPurge} />
        </Td>
      ) : null}
    </tr>
  );
}

function TrashDesignRow({
  d,
  canEdit,
  busy,
  onRestore,
  onPurge,
}: {
  d: TrashDesign;
  canEdit: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <Td className="font-medium">
        <Link
          href={`/orders/${d.order_id}`}
          className="num hover:text-accent hover:underline"
        >
          {d.order_no}
        </Link>
      </Td>
      <Td>{d.party_name}</Td>
      <Td>{d.quality}</Td>
      <Td className="num">{d.design_no}</Td>
      <Td className="num text-right">{formatNumber(d.qty_mtr)}</Td>
      <Td className="num whitespace-nowrap text-ink-soft">
        {formatDateTime(String(d.deleted_at))}
      </Td>
      {canEdit ? (
        <Td>
          <RowActions busy={busy} onRestore={onRestore} onPurge={onPurge} />
        </Td>
      ) : null}
    </tr>
  );
}

function RowActions({
  busy,
  onRestore,
  onPurge,
}: {
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onRestore}
        title="Restore"
      >
        <RotateCcwIcon /> Restore
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete permanently"
        title="Delete permanently"
        className="text-danger hover:bg-danger/10 hover:text-danger"
        disabled={busy}
        onClick={onPurge}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className ?? ""}`}>
      {children}
    </td>
  );
}

// Full-width restore + permanent-delete actions for the mobile cards (bigger
// tap targets and visible labels, unlike the compact desktop RowActions).
function CardActions({
  busy,
  onRestore,
  onPurge,
}: {
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="mt-2.5 flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={busy}
        onClick={onRestore}
      >
        <RotateCcwIcon /> Restore
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="flex-1 text-danger hover:bg-danger/10 hover:text-danger"
        disabled={busy}
        onClick={onPurge}
      >
        <Trash2Icon /> Delete
      </Button>
    </div>
  );
}

function TrashOrderCard({
  o,
  canEdit,
  busy,
  onRestore,
  onPurge,
}: {
  o: TrashOrder;
  canEdit: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="rounded-field border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/orders/${o.id}`}
            className="num font-semibold text-ink hover:text-accent hover:underline"
          >
            {o.order_no}
          </Link>
          <div className="truncate text-[13px] text-ink-soft">
            {o.party_name}
          </div>
        </div>
        <span className="num shrink-0 text-[12px] text-ink-muted">
          {formatDate(o.order_date)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <CardStat label="Designs" value={String(o.design_count)} />
        <CardStat label="Qty" value={formatNumber(o.qty_total)} />
        <CardStat label="Amount" value={`₹${formatNumber(o.grand_total)}`} />
      </div>
      <div className="num mt-2 text-[11px] text-ink-muted">
        Deleted {formatDateTime(String(o.deleted_at))}
      </div>
      {canEdit ? (
        <CardActions busy={busy} onRestore={onRestore} onPurge={onPurge} />
      ) : null}
    </div>
  );
}

function TrashDesignCard({
  d,
  canEdit,
  busy,
  onRestore,
  onPurge,
}: {
  d: TrashDesign;
  canEdit: boolean;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}) {
  return (
    <div className="rounded-field border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">
            {d.quality} · <span className="num">{d.design_no}</span>
          </div>
          <div className="truncate text-[13px] text-ink-soft">
            <Link
              href={`/orders/${d.order_id}`}
              className="num hover:text-accent hover:underline"
            >
              {d.order_no}
            </Link>{" "}
            · {d.party_name}
          </div>
        </div>
        <span className="num shrink-0 text-[12px] text-ink-muted">
          {formatNumber(d.qty_mtr)} mtr
        </span>
      </div>
      <div className="num mt-2 text-[11px] text-ink-muted">
        Deleted {formatDateTime(String(d.deleted_at))}
      </div>
      {canEdit ? (
        <CardActions busy={busy} onRestore={onRestore} onPurge={onPurge} />
      ) : null}
    </div>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-ink-muted">{label}</div>
      <div className="num truncate text-ink">{value}</div>
    </div>
  );
}
