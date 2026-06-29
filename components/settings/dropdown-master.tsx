"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type LookupRow = {
  id: string;
  category: string;
  value: string;
  is_active: boolean;
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "PARTY", label: "Party" },
  { key: "FABRIC", label: "Fabric" },
  { key: "AGENT", label: "Agent" },
  { key: "TRANSPORT", label: "Transport" },
  { key: "HASTE", label: "Haste" },
  { key: "SALES_PERSON", label: "Sales person" },
];

export function DropdownMaster() {
  const queryClient = useQueryClient();
  const [category, setCategory] = React.useState("PARTY");
  const [search, setSearch] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = React.useState(false);
  const [bulk, setBulk] = React.useState("");

  const list = useQuery({
    queryKey: ["lookups-admin", category],
    queryFn: () => apiGet<LookupRow[]>(`/api/lookups?category=${category}&all=1`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["lookups-admin", category] });
    queryClient.invalidateQueries({ queryKey: ["lookups", category] });
  }

  const add = useMutation({
    mutationFn: (value: string) =>
      apiSend("/api/lookups", "POST", { category, value }),
    onSuccess: () => {
      setNewValue("");
      invalidate();
      toast.success("Value added.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      apiSend(`/api/lookups/${vars.id}`, "PATCH", vars.body),
    onSuccess: () => {
      setEditId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiSend(`/api/lookups/${id}`, "DELETE"),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const hardDelete = useMutation({
    mutationFn: (id: string) => apiSend(`/api/lookups/${id}?hard=1`, "DELETE"),
    onSuccess: () => {
      setConfirmId(null);
      invalidate();
      toast.success("Value deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: (vars: { ids: string[]; hard: boolean }) =>
      apiSend<{ deleted?: number; deactivated?: number }>(
        "/api/lookups/bulk",
        "DELETE",
        { ids: vars.ids, hard: vars.hard },
      ),
    onSuccess: (res, vars) => {
      setSelected(new Set());
      setBulkConfirm(false);
      invalidate();
      const n = res.deleted ?? res.deactivated ?? vars.ids.length;
      toast.success(
        vars.hard
          ? `${n} value${n === 1 ? "" : "s"} deleted.`
          : `${n} value${n === 1 ? "" : "s"} deactivated.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkImport = useMutation({
    mutationFn: (values: string[]) =>
      apiSend<{ added: number; reactivated: number; skipped: number }>(
        "/api/lookups/bulk",
        "POST",
        { category, values },
      ),
    onSuccess: (res) => {
      setBulk("");
      invalidate();
      toast.success(
        `Imported: ${res.added} added, ${res.reactivated} reactivated, ${res.skipped} skipped.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (list.data ?? []).filter((r) =>
    r.value.toLowerCase().includes(search.trim().toLowerCase()),
  );

  // Keep selection limited to currently visible rows so the action bar count
  // never refers to rows hidden by the filter.
  const visibleSelectedIds = rows
    .filter((r) => selected.has(r.id))
    .map((r) => r.id);
  const selectedCount = visibleSelectedIds.length;
  const allVisibleSelected = rows.length > 0 && selectedCount === rows.length;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkConfirm(false);
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
    setBulkConfirm(false);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Dropdown Master</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  setCategory(c.key);
                  setEditId(null);
                  setSearch("");
                  setSelected(new Set());
                  setBulkConfirm(false);
                }}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-[13px] font-medium transition-colors",
                  category === c.key
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line-strong bg-surface-2 text-ink-soft hover:text-ink",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newValue.trim()) add.mutate(newValue.trim());
            }}
            className="flex gap-2"
          >
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={`Add a ${
                CATEGORIES.find((c) => c.key === category)?.label ?? "value"
              }…`}
            />
            <Button type="submit" disabled={add.isPending || !newValue.trim()}>
              Add
            </Button>
          </form>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter values…"
          />

          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-field border border-line bg-surface-2 px-3 py-2 text-sm">
              <label className="flex cursor-pointer items-center gap-2 text-ink-soft">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        selectedCount > 0 && !allVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                />
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : "Select all"}
              </label>

              {selectedCount > 0 ? (
                <div className="ml-auto flex items-center gap-2">
                  {bulkConfirm ? (
                    <>
                      <span className="text-danger">
                        Delete {selectedCount} permanently?
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={bulkDelete.isPending}
                        onClick={() =>
                          bulkDelete.mutate({
                            ids: visibleSelectedIds,
                            hard: true,
                          })
                        }
                      >
                        {bulkDelete.isPending ? (
                          <>
                            <Spinner className="text-white" /> Deleting…
                          </>
                        ) : (
                          "Delete"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setBulkConfirm(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={bulkDelete.isPending}
                        title="Deactivate selected (hide from dropdowns)"
                        onClick={() =>
                          bulkDelete.mutate({
                            ids: visibleSelectedIds,
                            hard: false,
                          })
                        }
                      >
                        Deactivate
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setBulkConfirm(true)}
                      >
                        <Trash2Icon /> Delete
                      </Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-field border border-line">
            {list.isLoading ? (
              <div className="flex items-center gap-2 px-4 py-8 text-sm text-ink-muted">
                <Spinner /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-ink-muted">
                No values.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm",
                      selected.has(r.id) && "bg-accent-soft/50",
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.value}`}
                      className="size-4 shrink-0 accent-[var(--accent)]"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                    {editId === r.id ? (
                      <>
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-9"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          aria-label="Save"
                          disabled={patch.isPending || !editValue.trim()}
                          onClick={() =>
                            patch.mutate({
                              id: r.id,
                              body: { value: editValue.trim() },
                            })
                          }
                        >
                          <CheckIcon />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Cancel"
                          onClick={() => setEditId(null)}
                        >
                          <XIcon />
                        </Button>
                      </>
                    ) : confirmId === r.id ? (
                      <>
                        <span className="flex-1 text-danger">
                          Delete “{r.value}” permanently?
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={hardDelete.isPending}
                          onClick={() => hardDelete.mutate(r.id)}
                        >
                          Delete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className={cn(
                            "flex-1",
                            !r.is_active && "text-ink-muted line-through",
                          )}
                        >
                          {r.value}
                        </span>
                        {!r.is_active ? (
                          <span className="rounded-pill bg-inset px-2 py-0.5 text-[11px] text-ink-muted">
                            inactive
                          </span>
                        ) : null}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => {
                            setEditId(r.id);
                            setEditValue(r.value);
                          }}
                        >
                          <PencilIcon />
                        </Button>
                        {r.is_active ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Deactivate"
                            title="Deactivate (hide from dropdowns)"
                            className="text-ink-muted hover:text-ink"
                            onClick={() => remove.mutate(r.id)}
                          >
                            <XIcon />
                          </Button>
                        ) : (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Reactivate"
                            title="Reactivate"
                            onClick={() =>
                              patch.mutate({ id: r.id, body: { is_active: true } })
                            }
                          >
                            <RotateCcwIcon />
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete permanently"
                          title="Delete permanently"
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={() => setConfirmId(r.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bulk paste</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            Paste one value per line to import into{" "}
            <b className="text-ink">
              {CATEGORIES.find((c) => c.key === category)?.label}
            </b>
            . Duplicates are skipped automatically.
          </p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={10}
            placeholder={"Value one\nValue two\nValue three"}
            className="w-full rounded-field border border-line-strong bg-surface-2 px-3.5 py-2.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-muted focus-visible:border-accent focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]"
          />
          <Button
            disabled={bulkImport.isPending || !bulk.trim()}
            onClick={() =>
              bulkImport.mutate(
                bulk
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              )
            }
          >
            {bulkImport.isPending ? (
              <>
                <Spinner className="text-white" /> Importing…
              </>
            ) : (
              "Import values"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
