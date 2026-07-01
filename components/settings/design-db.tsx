"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { formatDateTime } from "@/lib/orders";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type DesignRow = {
  id: string;
  created_at: string;
  order_no: string;
  fabric_name: string;
  design_no: string;
};
type DesignList = {
  designs: DesignRow[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export function DesignDatabasePanel() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = React.useState(false);

  const list = useQuery({
    queryKey: ["design-database", { search, page }],
    queryFn: () =>
      apiGet<DesignList>(
        `/api/design-database?search=${encodeURIComponent(search)}&page=${page}`,
      ),
    placeholderData: (prev) => prev,
  });

  const data = list.data;
  const rows = React.useMemo(() => data?.designs ?? [], [data]);

  // Drop any selections no longer visible (after refetch / page / search change).
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["design-database"] });
    queryClient.invalidateQueries({ queryKey: ["designs"] });
  }

  const remove = useMutation({
    mutationFn: (id: string) => apiSend(`/api/design-database/${id}`, "DELETE"),
    onSuccess: () => {
      invalidate();
      toast.success("Design row deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) =>
      apiSend<{ deleted: number }>("/api/design-database/bulk-delete", "POST", {
        ids,
      }),
    onSuccess: (res) => {
      setSelected(new Set());
      setConfirmBulk(false);
      invalidate();
      toast.success(`Deleted ${res.deleted} design${res.deleted === 1 ? "" : "s"}.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allOnPageSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.id));
  function toggleAll() {
    setSelected((prev) => {
      if (allOnPageSelected) {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
            className="flex w-full max-w-md gap-2"
          >
            <div className="relative flex-1">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search order no, fabric, design…"
                className="pl-8"
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          <Button
            variant="outline"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            {list.isFetching ? <Spinner /> : <RefreshCwIcon />} Refresh
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-line bg-surface-2 px-3 py-2.5 text-sm">
            <span className="font-medium">
              {selected.size} selected
            </span>
            {confirmBulk ? (
              <div className="flex items-center gap-2">
                <span className="text-danger">Delete permanently?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkDelete.isPending}
                  onClick={() => bulkDelete.mutate([...selected])}
                >
                  {bulkDelete.isPending ? <Spinner /> : null} Delete{" "}
                  {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmBulk(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmBulk(true)}
                >
                  <Trash2Icon /> Delete selected
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-field border border-line">
          {list.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-muted">
              No designs found{search ? ` for “${search}”` : ""}.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      className="size-4 accent-[var(--accent)]"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Order no</th>
                  <th className="px-3 py-2.5 font-medium">Fabric</th>
                  <th className="px-3 py-2.5 font-medium">Design no</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const checked = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={
                        "border-b border-line last:border-0 " +
                        (checked ? "bg-accent-soft/60" : "")
                      }
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.design_no}`}
                          checked={checked}
                          onChange={() => toggle(r.id)}
                          className="size-4 accent-[var(--accent)]"
                        />
                      </td>
                      <td className="num px-3 py-2.5 whitespace-nowrap text-ink-soft">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{r.order_no}</td>
                      <td className="px-3 py-2.5">{r.fabric_name}</td>
                      <td className="px-3 py-2.5">{r.design_no}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete"
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={() => remove.mutate(r.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {data && data.total_pages > 1 ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || list.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="num">
              {data.page} / {data.total_pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.total_pages || list.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
