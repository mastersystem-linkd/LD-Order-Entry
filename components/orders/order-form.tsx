"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { CheckIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatNumber, type OrderDetail } from "@/lib/orders";
import { Autocomplete } from "@/components/ui/autocomplete";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Reveal } from "@/components/ui/reveal";
import { Spinner } from "@/components/ui/spinner";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useDesigns, useLookup } from "@/components/orders/use-lookups";

type DesignRow = { design_no: string; qty_mtr: string };
type FabricBlockState = { fabric: string; rate: string; designs: DesignRow[] };
type HeaderState = {
  order_no: string;
  order_date: string;
  party_name: string;
  sales_person: string;
  agent: string;
  haste: string;
  transport: string;
  challan_no: string;
  lot_no: string;
  department: string;
  remarks: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankDesign = (): DesignRow => ({ design_no: "", qty_mtr: "" });
const blankFabric = (): FabricBlockState => ({
  fabric: "",
  rate: "",
  designs: [blankDesign()],
});
const blankHeader = (): HeaderState => ({
  order_no: "",
  order_date: todayISO(),
  party_name: "",
  sales_person: "",
  agent: "",
  haste: "",
  transport: "",
  challan_no: "",
  lot_no: "",
  department: "LD",
  remarks: "",
});

type DupStatus = "idle" | "checking" | "available" | "taken" | "error";

// Live money / qty figures — signature effect #4 (NumberFlow), mono tabular.
function Money({ value }: { value: number }) {
  return (
    <NumberFlow
      value={value}
      prefix="₹"
      format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
      className="num"
    />
  );
}

export function OrderForm({
  mode,
  orderId,
}: {
  mode: "create" | "edit";
  orderId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [header, setHeader] = React.useState<HeaderState>(blankHeader);
  const [blocks, setBlocks] = React.useState<FabricBlockState[]>([
    blankFabric(),
  ]);
  const [dup, setDup] = React.useState<DupStatus>("idle");
  const [originalOrderNo, setOriginalOrderNo] = React.useState<string>("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  // Autocomplete sources.
  const parties = useLookup("PARTY").data ?? [];
  const salesPeople = useLookup("SALES_PERSON").data ?? [];
  const agents = useLookup("AGENT").data ?? [];
  const hastes = useLookup("HASTE").data ?? [];
  const transports = useLookup("TRANSPORT").data ?? [];
  const fabrics = useLookup("FABRIC").data ?? [];

  // Edit mode: load the existing order and hydrate the form once.
  const detail = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiGet<OrderDetail>(`/api/orders/${orderId}`),
    enabled: mode === "edit" && !!orderId,
  });

  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (mode !== "edit" || !detail.data || hydrated.current) return;
    hydrated.current = true;
    const d = detail.data;
    setHeader({
      order_no: d.order.order_no,
      order_date: d.order.order_date,
      party_name: d.order.party_name,
      sales_person: d.order.sales_person ?? "",
      agent: d.order.agent ?? "",
      haste: d.order.haste ?? "",
      transport: d.order.transport ?? "",
      challan_no: d.order.challan_no ?? "",
      lot_no: d.order.lot_no ?? "",
      department: d.order.department ?? "LD",
      remarks: d.order.remarks ?? "",
    });
    setOriginalOrderNo(d.order.order_no);
    setBlocks(
      d.fabrics.length
        ? d.fabrics.map((f) => ({
            fabric: f.fabric,
            rate: f.rate == null ? "" : String(f.rate),
            designs: f.designs.length
              ? f.designs.map((dz) => ({
                  design_no: dz.design_no,
                  qty_mtr: String(dz.qty_mtr),
                }))
              : [blankDesign()],
          }))
        : [blankFabric()],
    );
  }, [mode, detail.data]);

  function setHeaderField<K extends keyof HeaderState>(
    key: K,
    value: HeaderState[K],
  ) {
    setHeader((h) => ({ ...h, [key]: value }));
  }

  // ---- Fabric block / design row mutators ----
  function updateBlock(i: number, patch: Partial<FabricBlockState>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function addBlock() {
    setBlocks((bs) => [...bs, blankFabric()]);
  }
  function removeBlock(i: number) {
    setBlocks((bs) => (bs.length === 1 ? bs : bs.filter((_, idx) => idx !== i)));
  }
  function updateDesign(bi: number, di: number, patch: Partial<DesignRow>) {
    setBlocks((bs) =>
      bs.map((b, idx) =>
        idx === bi
          ? {
              ...b,
              designs: b.designs.map((d, j) =>
                j === di ? { ...d, ...patch } : d,
              ),
            }
          : b,
      ),
    );
  }
  function addDesign(bi: number) {
    setBlocks((bs) =>
      bs.map((b, idx) =>
        idx === bi ? { ...b, designs: [...b.designs, blankDesign()] } : b,
      ),
    );
  }
  function removeDesign(bi: number, di: number) {
    setBlocks((bs) =>
      bs.map((b, idx) =>
        idx === bi
          ? {
              ...b,
              designs:
                b.designs.length === 1
                  ? b.designs
                  : b.designs.filter((_, j) => j !== di),
            }
          : b,
      ),
    );
  }

  // ---- Live totals ----
  const blockTotals = blocks.map((b) => {
    const rate = Number(b.rate) || 0;
    const rows = b.designs.map((d) => {
      const qty = Number(d.qty_mtr) || 0;
      return { qty, lineTotal: qty * rate };
    });
    return {
      qty: rows.reduce((s, r) => s + r.qty, 0),
      total: rows.reduce((s, r) => s + r.lineTotal, 0),
      rows,
    };
  });
  const grandQty = blockTotals.reduce((s, b) => s + b.qty, 0);
  const grandTotal = blockTotals.reduce((s, b) => s + b.total, 0);
  const designCount = blocks.reduce((s, b) => s + b.designs.length, 0);

  // ---- Order-no duplicate check (blur) ----
  async function checkOrderNo() {
    const value = header.order_no.trim();
    if (!value) {
      setDup("idle");
      return;
    }
    if (mode === "edit" && value === originalOrderNo) {
      setDup("available");
      return;
    }
    setDup("checking");
    try {
      const res = await apiGet<{ available: boolean }>(
        `/api/orders/check-no?orderNo=${encodeURIComponent(value)}`,
      );
      setDup(res.available ? "available" : "taken");
    } catch {
      setDup("error");
    }
  }

  // ---- Build payload + validate ----
  function buildPayload() {
    const cleanedBlocks = blocks.map((b) => ({
      fabric: b.fabric.trim(),
      rate: b.rate.trim() === "" ? null : Number(b.rate),
      designs: b.designs
        .filter((d) => d.design_no.trim() !== "" || d.qty_mtr.trim() !== "")
        .map((d) => ({
          design_no: d.design_no.trim(),
          qty_mtr: Number(d.qty_mtr),
        })),
    }));
    return {
      order: {
        order_no: header.order_no.trim(),
        order_date: header.order_date,
        party_name: header.party_name.trim(),
        sales_person: header.sales_person.trim() || null,
        agent: header.agent.trim() || null,
        haste: header.haste.trim() || null,
        transport: header.transport.trim() || null,
        challan_no: header.challan_no.trim() || null,
        lot_no: header.lot_no.trim() || null,
        department: header.department.trim() || "LD",
        remarks: header.remarks.trim() || null,
      },
      fabrics: cleanedBlocks,
    };
  }

  function validate(): string | null {
    if (!header.order_no.trim()) return "Order no is required.";
    if (!header.order_date) return "Order date is required.";
    if (!header.party_name.trim()) return "Party is required.";
    if (dup === "taken")
      return `Order number "${header.order_no.trim()}" already exists.`;
    const payload = buildPayload();
    if (payload.fabrics.length === 0) return "Add at least one fabric block.";
    for (const [i, f] of payload.fabrics.entries()) {
      if (!f.fabric) return `Fabric block ${i + 1}: fabric is required.`;
      if (f.designs.length === 0)
        return `Fabric block ${i + 1}: add at least one design row.`;
      for (const d of f.designs) {
        if (!d.design_no)
          return `Fabric block ${i + 1}: every design row needs a design no.`;
        if (!(d.qty_mtr > 0))
          return `Fabric block ${i + 1}: qty must be greater than 0.`;
      }
    }
    return null;
  }

  function openPreview() {
    const err = validate();
    if (err) {
      setFormError(err);
      toast.error(err);
      return;
    }
    setFormError(null);
    setPreviewOpen(true);
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return mode === "create"
        ? apiSend<{ id: string; order_no: string }>(
            "/api/orders",
            "POST",
            payload,
          )
        : apiSend<{ id: string; order_no: string }>(
            `/api/orders/${orderId}`,
            "PUT",
            payload,
          );
    },
    onSuccess: (res) => {
      setPreviewOpen(false);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["designs"] });
      if (orderId)
        queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      toast.success(
        mode === "create"
          ? `Order ${res.order_no} created.`
          : `Order ${res.order_no} updated.`,
      );
      router.push("/orders");
      router.refresh();
    },
    onError: (err: Error) => {
      setPreviewOpen(false);
      setFormError(err.message);
      toast.error(err.message);
    },
  });

  if (mode === "edit" && detail.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> Loading order…
      </div>
    );
  }
  if (mode === "edit" && detail.isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-danger">
          {(detail.error as Error)?.message ?? "Failed to load order."}
        </CardContent>
      </Card>
    );
  }

  const payload = buildPayload();

  return (
    <form
      className="flex flex-col gap-[18px] pb-[104px]"
      onSubmit={(e) => {
        e.preventDefault();
        openPreview();
      }}
    >
      {/* Header */}
      <Reveal index={0}>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Order details</CardTitle>
            <Eyebrow>{mode === "create" ? "Draft" : "Editing"}</Eyebrow>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-[22px] gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Order date" htmlFor="order_date" required>
              <Input
                id="order_date"
                type="date"
                className="num"
                value={header.order_date}
                onChange={(e) => setHeaderField("order_date", e.target.value)}
              />
            </Field>

            <Field
              label="Order no"
              htmlFor="order_no"
              required
              hint={
                dup === "checking"
                  ? "Checking…"
                  : dup === "taken"
                    ? "Already exists"
                    : dup === "available"
                      ? "Available"
                      : undefined
              }
              hintTone={
                dup === "taken"
                  ? "danger"
                  : dup === "available"
                    ? "success"
                    : "muted"
              }
            >
              <Input
                id="order_no"
                className="num"
                value={header.order_no}
                placeholder="LKD-08-25-003"
                aria-invalid={dup === "taken"}
                onChange={(e) => {
                  setHeaderField("order_no", e.target.value);
                  setDup("idle");
                }}
                onBlur={checkOrderNo}
              />
            </Field>

            <Field label="Party" htmlFor="party_name" required>
              <Autocomplete
                id="party_name"
                value={header.party_name}
                onValueChange={(v) => setHeaderField("party_name", v)}
                suggestions={parties}
                placeholder="Party name"
              />
            </Field>

            <Field label="Sales person" htmlFor="sales_person">
              <Autocomplete
                id="sales_person"
                value={header.sales_person}
                onValueChange={(v) => setHeaderField("sales_person", v)}
                suggestions={salesPeople}
                placeholder="Search…"
              />
            </Field>

            <Field label="Agent" htmlFor="agent">
              <Autocomplete
                id="agent"
                value={header.agent}
                onValueChange={(v) => setHeaderField("agent", v)}
                suggestions={agents}
                placeholder="Search…"
              />
            </Field>

            <Field label="Haste" htmlFor="haste">
              <Autocomplete
                id="haste"
                value={header.haste}
                onValueChange={(v) => setHeaderField("haste", v)}
                suggestions={hastes}
                placeholder="Search…"
              />
            </Field>

            <Field label="Transport" htmlFor="transport">
              <Autocomplete
                id="transport"
                value={header.transport}
                onValueChange={(v) => setHeaderField("transport", v)}
                suggestions={transports}
                placeholder="Search…"
              />
            </Field>

            <Field label="Challan no" htmlFor="challan_no">
              <Input
                id="challan_no"
                value={header.challan_no}
                onChange={(e) => setHeaderField("challan_no", e.target.value)}
                placeholder="—"
              />
            </Field>

            <Field label="Lot no" htmlFor="lot_no">
              <Input
                id="lot_no"
                value={header.lot_no}
                onChange={(e) => setHeaderField("lot_no", e.target.value)}
                placeholder="—"
              />
            </Field>

            <Field label="Department" htmlFor="department">
              <Input
                id="department"
                value={header.department}
                onChange={(e) => setHeaderField("department", e.target.value)}
              />
            </Field>

            <Field
              label="Remarks"
              htmlFor="remarks"
              className="sm:col-span-2 lg:col-span-3"
            >
              <Input
                id="remarks"
                value={header.remarks}
                onChange={(e) => setHeaderField("remarks", e.target.value)}
                placeholder="Optional notes"
              />
            </Field>
          </CardContent>
        </Card>
      </Reveal>

      {/* Fabric blocks */}
      {blocks.map((block, bi) => (
        <Reveal key={bi} index={bi + 1}>
          <div className="glass relative overflow-hidden rounded-card border border-line-strong p-6 shadow-md transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-lg motion-reduce:hover:translate-y-0">
            <span className="absolute inset-y-0 left-0 w-1 bg-[linear-gradient(var(--a1),var(--a2))]" />
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
                <span className="num grid size-[26px] place-items-center rounded-[8px] bg-accent-soft text-[13px] text-accent">
                  {bi + 1}
                </span>
                Fabric block
              </div>
              <button
                type="button"
                onClick={() => removeBlock(bi)}
                disabled={blocks.length === 1}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13.5px] font-medium text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2Icon className="size-[15px]" /> Remove
              </button>
            </div>

            <div className="mb-[18px] grid grid-cols-1 gap-x-[22px] gap-y-[18px] sm:grid-cols-[1.3fr_0.7fr]">
              <Field label="Fabric" required>
                <Autocomplete
                  value={block.fabric}
                  onValueChange={(v) => updateBlock(bi, { fabric: v })}
                  suggestions={fabrics}
                  placeholder="Fabric / quality"
                />
              </Field>
              <Field label="Rate (per mtr)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="num"
                  value={block.rate}
                  onChange={(e) => updateBlock(bi, { rate: e.target.value })}
                  placeholder="0.00"
                />
              </Field>
            </div>

            {/* Design rows */}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[1.5fr_0.7fr_0.7fr_44px] items-center gap-3.5 px-1 text-[12px] font-medium text-ink-muted">
                <span>Design no</span>
                <span>Qty (mtr)</span>
                <span className="text-right">Line total</span>
                <span />
              </div>
              {block.designs.map((d, di) => (
                <div
                  key={di}
                  className="grid grid-cols-[1.5fr_0.7fr_0.7fr_44px] items-center gap-3.5"
                >
                  <DesignAutocomplete
                    fabric={block.fabric}
                    value={d.design_no}
                    onValueChange={(v) => updateDesign(bi, di, { design_no: v })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="num"
                    value={d.qty_mtr}
                    onChange={(e) =>
                      updateDesign(bi, di, { qty_mtr: e.target.value })
                    }
                    placeholder="0"
                  />
                  <span className="flex h-[46px] items-center justify-end pr-1 text-[15px] text-ink">
                    <Money value={blockTotals[bi].rows[di]?.lineTotal ?? 0} />
                  </span>
                  <div className="grid h-[46px] place-items-center">
                    <button
                      type="button"
                      onClick={() => removeDesign(bi, di)}
                      disabled={block.designs.length === 1}
                      aria-label="Remove design"
                      className="grid size-[38px] place-items-center rounded-[10px] border border-line bg-surface-2 text-ink-muted transition-colors hover:border-danger/35 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-dashed border-line-strong pt-[18px]">
                <Button type="button" variant="outline" size="lg" onClick={() => addDesign(bi)}>
                  <PlusIcon /> Add design
                </Button>
                <div className="text-[13.5px] text-ink-soft">
                  Block qty{" "}
                  <b className="num ml-1 text-[15px] font-semibold text-ink">
                    {formatNumber(blockTotals[bi].qty)}
                  </b>{" "}
                  · subtotal{" "}
                  <b className="ml-1 text-[15px] font-semibold text-ink">
                    <Money value={blockTotals[bi].total} />
                  </b>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      ))}

      <Reveal index={blocks.length + 1}>
        <button
          type="button"
          onClick={addBlock}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface-2 text-[14px] font-medium text-ink transition-[color,background-color,border-color] hover:border-accent hover:bg-accent-soft hover:text-accent active:scale-[.99]"
        >
          <PlusIcon className="size-4" /> Add fabric block
        </button>
      </Reveal>

      {formError ? (
        <p
          role="alert"
          className="rounded-field bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {formError}
        </p>
      ) : null}

      {/* Sticky totals bar */}
      <div className="glass fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 border-t border-line px-[34px] py-4 sm:flex-row sm:items-center sm:justify-between md:left-[264px]">
        <div className="flex items-baseline gap-3.5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Grand total
          </span>
          <span className="num grad-text font-display text-[34px] font-semibold tracking-[-0.03em]">
            <Money value={grandTotal} />
          </span>
        </div>
        <div className="hidden text-[13px] text-ink-soft md:block">
          {blocks.length} fabric · {designCount} design
          {designCount === 1 ? "" : "s"} · {formatNumber(grandQty)} mtr
        </div>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="border border-line-strong"
            onClick={() => router.push("/orders")}
          >
            Cancel
          </Button>
          <Button type="submit" size="lg">
            <CheckIcon /> {mode === "create" ? "Create order" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Preview modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "create" ? "Confirm new order" : "Confirm changes"}
            </DialogTitle>
            <DialogDescription>
              Review the order before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Detail term="Order no" value={payload.order.order_no} mono />
              <Detail term="Order date" value={payload.order.order_date} mono />
              <Detail term="Party" value={payload.order.party_name} />
              <Detail
                term="Sales person"
                value={payload.order.sales_person ?? "—"}
              />
              <Detail term="Challan no" value={payload.order.challan_no ?? "—"} />
              <Detail term="Lot no" value={payload.order.lot_no ?? "—"} />
            </dl>

            <div className="overflow-hidden rounded-field border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-inset text-xs text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Fabric</th>
                    <th className="px-3 py-2">Design</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.fabrics.flatMap((f, fi) =>
                    f.designs.map((d, di) => (
                      <tr key={`${fi}-${di}`} className="border-t border-line">
                        <td className="px-3 py-2">{f.fabric}</td>
                        <td className="px-3 py-2">{d.design_no}</td>
                        <td className="px-3 py-2 text-right num">
                          {formatNumber(d.qty_mtr)}
                        </td>
                        <td className="px-3 py-2 text-right num">
                          {f.rate == null ? "—" : formatNumber(f.rate)}
                        </td>
                        <td className="px-3 py-2 text-right num">
                          {formatNumber((f.rate ?? 0) * d.qty_mtr)}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-inset font-medium">
                    <td className="px-3 py-2" colSpan={2}>
                      Grand total
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {formatNumber(grandQty)}
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right num">
                      ₹{formatNumber(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(false)}
              disabled={save.isPending}
            >
              Back
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? (
                <>
                  <Spinner className="text-white" /> Saving…
                </>
              ) : mode === "create" ? (
                "Confirm & create"
              ) : (
                "Confirm & save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

// Design autocomplete scoped to its block's fabric (OE-P5 STEP 3).
function DesignAutocomplete({
  fabric,
  value,
  onValueChange,
}: {
  fabric: string;
  value: string;
  onValueChange: (v: string) => void;
}) {
  // Debounce the fabric so typing it doesn't fire a query per keystroke.
  const debouncedFabric = useDebouncedValue(fabric, 350);
  const designs = useDesigns(debouncedFabric).data ?? [];
  return (
    <Autocomplete
      value={value}
      onValueChange={onValueChange}
      suggestions={designs}
      placeholder="Design no"
    />
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
      {children}
    </span>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  hintTone = "muted",
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  hintTone?: "muted" | "danger" | "success";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-[7px] ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-soft">
          {label}
          {required ? <span className="font-semibold text-danger"> *</span> : null}
        </Label>
        {hint ? (
          <span
            className={
              hintTone === "danger"
                ? "text-xs text-danger"
                : hintTone === "success"
                  ? "text-xs text-success"
                  : "text-xs text-ink-muted"
            }
          >
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Detail({
  term,
  value,
  mono,
}: {
  term: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{term}</dt>
      <dd className={`font-medium text-ink ${mono ? "num" : ""}`}>{value}</dd>
    </div>
  );
}
