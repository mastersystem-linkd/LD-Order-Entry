"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { CheckIcon, ClipboardListIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { cn } from "@/lib/utils";
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
import { Th } from "@/components/ui/table";
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
// Default party for new orders (CLAUDE.md §4: free text — this is just a
// pre-fill, not a catalog constraint; clear/replace it freely).
const DEFAULT_PARTY = "LD Silk Mills";
const blankHeader = (): HeaderState => ({
  order_no: "",
  order_date: todayISO(),
  party_name: DEFAULT_PARTY,
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

// Column template shared by the design-row header and the rows so the two can
// never drift apart. The action column is narrow on mobile (remove only) and
// widens on sm+ where the per-row add (+) button also shows — keeping the
// design input from getting squeezed on small screens.
const DESIGN_ROW_COLS =
  "grid-cols-[minmax(0,1fr)_4rem_5.5rem_2.5rem] sm:grid-cols-[minmax(0,1fr)_4rem_5.5rem_4.5rem]";
// Guard-rail so a fat-fingered bulk count can't spawn thousands of rows.
const MAX_BULK_DESIGNS = 100;
// localStorage key for the in-progress "new order" draft, so a refresh (or an
// accidental tab close) never loses typed-in data. Bump the suffix if the
// draft shape ever changes. Create mode only — edit mode reloads from the DB.
const NEW_ORDER_DRAFT_KEY = "oe:new-order-draft:v1";

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

  // After adding design rows we focus the first new row's Design-no input so the
  // user can keep typing without reaching for the mouse. The input is located by
  // its block-scoped aria-label once the new row has rendered.
  const [pendingFocus, setPendingFocus] = React.useState<{
    bi: number;
    di: number;
  } | null>(null);
  React.useEffect(() => {
    if (!pendingFocus) return;
    const { bi, di } = pendingFocus;
    const el = document.querySelector<HTMLInputElement>(
      `[data-fabric-block="${bi}"] [aria-label="Design no, row ${di + 1}"]`,
    );
    el?.focus();
    setPendingFocus(null);
  }, [pendingFocus, blocks]);

  // ---- Draft autosave (create mode) ----
  // Restore any saved draft on mount, then persist every change so a hard
  // refresh keeps the typed-in data. `draftReady` gates persistence until the
  // restore pass has run, so we never overwrite the saved draft with the blank
  // initial state. (It's a state, not a ref, so the persist effect sees `false`
  // on its first pass in the same commit as the restore.)
  const [draftReady, setDraftReady] = React.useState(false);
  React.useEffect(() => {
    if (mode !== "create") {
      setDraftReady(true);
      return;
    }
    try {
      const raw = localStorage.getItem(NEW_ORDER_DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as {
          header?: HeaderState;
          blocks?: FabricBlockState[];
        };
        if (d?.header) setHeader(d.header);
        if (Array.isArray(d?.blocks) && d.blocks.length) setBlocks(d.blocks);
      }
    } catch {
      // Corrupt/unavailable draft → start fresh.
    }
    setDraftReady(true);
  }, [mode]);
  React.useEffect(() => {
    if (!draftReady || mode !== "create") return;
    try {
      localStorage.setItem(
        NEW_ORDER_DRAFT_KEY,
        JSON.stringify({ header, blocks }),
      );
    } catch {
      // Ignore quota/privacy-mode failures — the draft just won't persist.
    }
  }, [draftReady, mode, header, blocks]);

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
  // New designs inherit the block's qty (the first row's value) so the common
  // case — all designs share a qty — needs no re-typing.
  const inheritedQty = (b: FabricBlockState) => b.designs[0]?.qty_mtr ?? "";

  function addDesign(bi: number) {
    const last = blocks[bi]?.designs.length ?? 0;
    setBlocks((bs) =>
      bs.map((b, idx) =>
        idx === bi
          ? {
              ...b,
              designs: [
                ...b.designs,
                { design_no: "", qty_mtr: inheritedQty(b) },
              ],
            }
          : b,
      ),
    );
    setPendingFocus({ bi, di: last });
  }
  // Insert a blank design directly below row `di` and focus it — used by the
  // per-row + button and by pressing Enter inside a design row.
  function insertDesignAfter(bi: number, di: number) {
    setBlocks((bs) =>
      bs.map((b, idx) => {
        if (idx !== bi) return b;
        const designs = [...b.designs];
        designs.splice(di + 1, 0, {
          design_no: "",
          qty_mtr: inheritedQty(b),
        });
        return { ...b, designs };
      }),
    );
    setPendingFocus({ bi, di: di + 1 });
  }
  // Append `count` blank designs at once (the "add 5 rows" shortcut).
  function addManyDesigns(bi: number, count: number) {
    const n = Math.min(Math.max(Math.floor(count), 1), MAX_BULK_DESIGNS);
    const start = blocks[bi]?.designs.length ?? 0;
    setBlocks((bs) =>
      bs.map((b, idx) =>
        idx === bi
          ? {
              ...b,
              designs: [
                ...b.designs,
                ...Array.from({ length: n }, () => ({
                  design_no: "",
                  qty_mtr: inheritedQty(b),
                })),
              ],
            }
          : b,
      ),
    );
    setPendingFocus({ bi, di: start });
  }
  // Editing the FIRST design's qty carries forward to the block's other rows,
  // but only those still holding the previous common value (or empty) — manual
  // per-row overrides are preserved.
  function setFirstDesignQty(bi: number, value: string) {
    setBlocks((bs) =>
      bs.map((b, idx) => {
        if (idx !== bi) return b;
        const prev = b.designs[0]?.qty_mtr ?? "";
        return {
          ...b,
          designs: b.designs.map((d, j) =>
            j === 0
              ? { ...d, qty_mtr: value }
              : d.qty_mtr === "" || d.qty_mtr === prev
                ? { ...d, qty_mtr: value }
                : d,
          ),
        };
      }),
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

  // A fabric chosen in one block is hidden from the OTHER blocks' suggestions so
  // the same fabric isn't picked twice (free text is still allowed — §4).
  function fabricOptionsFor(bi: number) {
    const takenElsewhere = new Set(
      blocks
        .filter((_, idx) => idx !== bi)
        .map((b) => b.fabric.trim().toLowerCase())
        .filter(Boolean),
    );
    return fabrics.filter((f) => !takenElsewhere.has(f.toLowerCase()));
  }

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
      // Order saved — discard the local draft so the next New order starts blank.
      if (mode === "create") {
        try {
          localStorage.removeItem(NEW_ORDER_DRAFT_KEY);
        } catch {}
      }
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
      className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 pb-[104px]"
      onSubmit={(e) => {
        e.preventDefault();
        openPreview();
      }}
    >
      {/* Header */}
      <Reveal index={0}>
        <Card data-size="sm" className="gap-3">
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
                <ClipboardListIcon className="size-4" />
              </span>
              <CardTitle>Order details</CardTitle>
            </div>
            {mode === "edit" ? <Eyebrow>Editing</Eyebrow> : null}
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-3 gap-y-2 sm:gap-x-4 lg:grid-cols-3 [&_input]:h-9">
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

            <Field
              label="Remarks"
              htmlFor="remarks"
              className="col-span-2 lg:col-span-3"
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
          <div
            data-fabric-block={bi}
            className="glass relative overflow-hidden rounded-card border border-line-strong p-3 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-[2px] hover:shadow-md motion-reduce:hover:translate-y-0 sm:p-4"
          >
            <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-accent to-[var(--a3)]" />
            <span
              aria-hidden
              className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full opacity-[0.05]"
              style={{
                background:
                  "radial-gradient(circle, var(--accent), transparent 70%)",
              }}
            />
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <span className="num grid size-[24px] place-items-center rounded-[7px] bg-gradient-to-br from-accent to-[var(--a3)] text-[12.5px] font-semibold text-white shadow-sm">
                  {bi + 1}
                </span>
                Fabric block
              </div>
              <button
                type="button"
                onClick={() => removeBlock(bi)}
                disabled={blocks.length === 1}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2Icon className="size-[15px]" /> Remove
              </button>
            </div>

            {/* Shared block fields (one fabric + rate per block), then an
                aligned list of design rows. Fully responsive: the columns fit
                the viewport so mobile never needs horizontal scrolling. The
                suggestion dropdowns portal out, so nothing clips them. */}
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-[1fr_6rem] gap-2.5 sm:grid-cols-[minmax(180px,1.6fr)_120px]">
                <Field label="Fabric" required>
                  <Autocomplete
                    value={block.fabric}
                    onValueChange={(v) => updateBlock(bi, { fabric: v })}
                    suggestions={fabricOptionsFor(bi)}
                    placeholder="Fabric / quality"
                    aria-label={`Fabric, block ${bi + 1}`}
                    className="h-10 text-[13.5px]"
                  />
                </Field>
                <Field label="Rate">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="num h-10 px-2 text-right text-[13.5px]"
                    value={block.rate}
                    onChange={(e) => updateBlock(bi, { rate: e.target.value })}
                    placeholder="0.00"
                    aria-label={`Rate per metre, block ${bi + 1}`}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-1.5">
                <div
                  className={cn(
                    "grid gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted",
                    DESIGN_ROW_COLS,
                  )}
                >
                  <span>
                    Design no<span className="text-danger"> *</span>
                  </span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Total</span>
                  <span />
                </div>

                {block.designs.map((d, di) => (
                  <div
                    key={di}
                    // Enter anywhere in the row adds the next design and focuses
                    // it — unless the design autocomplete already consumed Enter
                    // to pick a suggestion (then defaultPrevented is set).
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.defaultPrevented) {
                        e.preventDefault();
                        insertDesignAfter(bi, di);
                      }
                    }}
                    className={cn(
                      "grid items-center gap-2",
                      DESIGN_ROW_COLS,
                    )}
                  >
                    <DesignAutocomplete
                      fabric={block.fabric}
                      value={d.design_no}
                      onValueChange={(v) =>
                        updateDesign(bi, di, { design_no: v })
                      }
                      aria-label={`Design no, row ${di + 1}`}
                      className="h-10 text-[13.5px]"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="num h-10 px-2 text-right text-[13.5px]"
                      value={d.qty_mtr}
                      onChange={(e) =>
                        di === 0
                          ? setFirstDesignQty(bi, e.target.value)
                          : updateDesign(bi, di, { qty_mtr: e.target.value })
                      }
                      placeholder="0"
                      aria-label={`Quantity in metres, row ${di + 1}`}
                    />
                    <div className="num flex h-9 items-center justify-end pr-0.5 text-[13px] font-medium text-ink">
                      <Money value={blockTotals[bi].rows[di]?.lineTotal ?? 0} />
                    </div>
                    <div className="flex h-9 items-center justify-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => insertDesignAfter(bi, di)}
                        aria-label="Add design below"
                        title="Add design (or press Enter)"
                        className="hidden size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent sm:grid"
                      >
                        <PlusIcon className="size-[16px]" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDesign(bi, di)}
                        disabled={block.designs.length === 1}
                        aria-label="Remove design"
                        className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
                      >
                        <Trash2Icon className="size-[15px]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-line-strong pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addDesign(bi)}
                >
                  <PlusIcon /> Add design
                </Button>
                <BulkAddDesigns onAdd={(n) => addManyDesigns(bi, n)} />
              </div>
              <div className="text-[13px] text-ink-soft">
                Block qty{" "}
                <b className="num text-[14px] font-semibold text-ink">
                  {formatNumber(blockTotals[bi].qty)}
                </b>{" "}
                · subtotal{" "}
                <b className="text-[14px] font-semibold text-ink">
                  <Money value={blockTotals[bi].total} />
                </b>
              </div>
            </div>
          </div>
        </Reveal>
      ))}

      <Reveal index={blocks.length + 1}>
        <button
          type="button"
          onClick={addBlock}
          className="flex h-[46px] w-full items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface-2 text-[14px] font-medium text-ink transition-[color,background-color,border-color] hover:border-accent hover:bg-accent-soft hover:text-accent active:scale-[.99]"
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
      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line px-4 py-3 shadow-[0_-4px_20px_rgba(16,24,40,0.06)] sm:px-[34px] sm:py-4 md:left-[264px]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
        />
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-3.5">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">
              Grand total
            </span>
            <span className="num font-display text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">
              <Money value={grandTotal} />
            </span>
          </div>
          <div className="hidden text-[13px] text-ink-soft md:block">
            {blocks.length} fabric · {designCount} design
            {designCount === 1 ? "" : "s"} · {formatNumber(grandQty)} mtr
          </div>
          <div className="flex gap-3 [&>*]:flex-1 sm:[&>*]:flex-none">
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
      </div>

      {/* Preview modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
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

            <div className="overflow-x-auto rounded-field border border-line">
              <table className="w-full min-w-[440px] text-left text-sm">
                <thead className="bg-inset">
                  <tr>
                    <Th>Fabric</Th>
                    <Th>Design</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Rate</Th>
                    <Th className="text-right">Line total</Th>
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
  className,
  "aria-label": ariaLabel,
}: {
  fabric: string;
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  "aria-label"?: string;
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
      aria-label={ariaLabel ?? "Design no"}
      className={className}
    />
  );
}

// Compact "add N rows at once" control: type a count and press Enter (or click
// Add) to append that many blank design rows. Self-contained local state so the
// big form component doesn't carry a per-block draft value.
function BulkAddDesigns({ onAdd }: { onAdd: (count: number) => void }) {
  const [count, setCount] = React.useState("");
  function submit() {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) return;
    onAdd(n);
    setCount("");
  }
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
      <span className="hidden sm:inline">Add</span>
      <Input
        type="number"
        min="1"
        max={MAX_BULK_DESIGNS}
        inputMode="numeric"
        value={count}
        onChange={(e) => setCount(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="5"
        aria-label="Number of design rows to add"
        className="num h-8 w-16 px-2 text-center text-[13px]"
      />
      <span>rows</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={submit}
        disabled={Math.floor(Number(count)) < 1}
      >
        Add
      </Button>
    </div>
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
