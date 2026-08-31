"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  IndianRupeeIcon,
  LinkIcon,
  MinusIcon,
  SearchIcon,
  StarIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import { apiGet } from "@/lib/api-client";
import {
  CUSTOMER_SIGNAL_LABEL,
  customerSignal,
  type CustomerList,
  type CustomerRow,
  type CustomerSort,
} from "@/lib/crm";
import { formatDate, formatNumber } from "@/lib/orders";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { HScroll } from "@/components/ui/h-scroll";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/ui/pager";
import { Stars } from "@/components/ui/star-rating";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th, THead } from "@/components/ui/table";
import { Pill } from "@/components/crm/crm-pill";

// CRM → Customers (CLAUDE.md §12.5.4, OE-P18). A read-only roll-up: orders and
// value from the order book, ratings and complaints from the CRM.
//
// Two honesty rules run through this screen:
//   * A customer nobody has called shows "—", never a zero rating. Four of the
//     columns here are empty until the queue is worked, and that emptiness is
//     the true state of the data — it must not be dressed up as a score.
//   * Rows are grouped on crr_customer_id where we have one. Where we do not,
//     the party name is the group, and the row is tagged so nobody mistakes a
//     spelling for a customer record.

const selectCls =
  "h-9 rounded-field border border-line bg-surface px-2.5 text-[12.5px] text-ink outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)]";

const SORTS: { value: CustomerSort; label: string }[] = [
  { value: "value", label: "Sorted by value" },
  { value: "orders", label: "Most orders" },
  { value: "rating", label: "Lowest rated first" },
  { value: "issues", label: "Most complaints" },
  { value: "name", label: "Name (A–Z)" },
];

const SIGNAL_TONE = {
  at_risk: "late",
  unhappy: "warn",
  reorder: "done",
  sample: "progress",
  none: "due",
} as const;

function money(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${formatNumber(n)}`;
}

function Trend({ v }: { v: number | null }) {
  // Null is "not enough rated calls to compare" — deliberately not "steady",
  // which would claim a stability we have no evidence for.
  if (v === null) return <span className="text-ink-muted">—</span>;
  if (Math.abs(v) < 0.25) {
    return (
      <span className="inline-flex items-center gap-1 text-ink-muted">
        <MinusIcon className="size-3.5" /> steady
      </span>
    );
  }
  const up = v > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-semibold",
        up ? "text-success" : "text-danger",
      )}
    >
      {up ? (
        <ArrowUpRightIcon className="size-3.5" />
      ) : (
        <ArrowDownRightIcon className="size-3.5" />
      )}
      {up ? "+" : ""}
      {v.toFixed(1)}
    </span>
  );
}

export function CustomersView() {
  const [rawSearch, setRawSearch] = React.useState("");
  const [sort, setSort] = React.useState<CustomerSort>("value");
  const [rated, setRated] = React.useState("");
  const [page, setPage] = React.useState(1);

  const search = useDebouncedValue(rawSearch, 250);

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("sort", sort);
  if (rated) params.set("rated", rated);
  if (search) params.set("q", search);
  const qs = params.toString();

  const q = useQuery({
    queryKey: ["crm-customers", qs],
    queryFn: () => apiGet<CustomerList>(`/api/crm/customers?${qs}`),
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    setPage(1);
  }, [sort, rated, search]);

  const data = q.data;
  const rows = data?.rows ?? [];
  const k = data?.kpis;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UsersIcon />}
          label="Customers"
          value={k ? formatNumber(k.customers) : "—"}
          sub="with at least one live order"
        />
        <StatCard
          icon={<LinkIcon />}
          label="Matched to CRR"
          value={k ? `${k.linked} / ${k.customers}` : "—"}
          sub={k ? `${k.unlinked} still grouped by name` : undefined}
          tone="slate"
        />
        <StatCard
          icon={<StarIcon />}
          label="Rated"
          value={k ? formatNumber(k.rated) : "—"}
          sub="customers with a completed call"
          tone="amber"
        />
        <StatCard
          icon={<TriangleAlertIcon />}
          label="At risk"
          value={k ? formatNumber(k.atRisk) : "—"}
          sub="low rating or an open complaint"
          tone="red"
        />
      </div>

      {/* An empty CRM is the expected state on day one. Say so, rather than
          letting four dashes per row read as a bug. */}
      {k && k.rated === 0 ? (
        <div className="rounded-card border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-soft shadow-sm">
          <b className="text-ink">No follow-up has been completed yet</b>, so
          rating, trend, complaints and last-contacted are empty for everyone.
          Orders and value below are real. The rest fills in as the{" "}
          <b className="text-ink">Follow-ups</b> queue is worked.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2.5 shadow-sm">
        <div className="relative min-w-[220px] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Party name or CRR customer id…"
            className="h-9 pl-8"
          />
        </div>
        <select
          className={selectCls}
          value={rated}
          onChange={(e) => setRated(e.target.value)}
        >
          <option value="">All ratings</option>
          <option value="low">Rated 3 or below</option>
          <option value="high">Rated 4–5</option>
        </select>
        <select
          className={selectCls}
          value={sort}
          onChange={(e) => setSort(e.target.value as CustomerSort)}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[11.5px] text-ink-muted">
          Read-only · grouped by CRR customer
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-end gap-3 px-4 pt-4 pb-3">
          <div>
            <CardTitle>Customer history</CardTitle>
            <CardDescription>
              A view over orders, follow-ups and complaints — never a second
              customer master, and party names are shown exactly as typed.
            </CardDescription>
          </div>
        </div>

        <HScroll>
          <Table>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Orders 12m</Th>
                <Th className="text-right">Value 12m</Th>
                <Th>Avg rating</Th>
                <Th>Trend</Th>
                <Th className="text-right">Open issues</Th>
                <Th>Last contacted</Th>
                <Th>Last order</Th>
                <Th>Signal</Th>
              </tr>
            </THead>
            <tbody>
              {q.isLoading ? (
                <tr>
                  <Td colSpan={9} className="py-10 text-center text-ink-muted">
                    Loading…
                  </Td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <Td colSpan={9} className="py-10 text-center text-ink-muted">
                    No customers match.
                  </Td>
                </tr>
              ) : (
                rows.map((r: CustomerRow) => {
                  const sig = customerSignal(r);
                  return (
                    <tr key={r.key} className="group">
                      <Td>
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-[11.5px] text-ink-muted">
                          {r.crrCustomerId !== null ? (
                            <>
                              CRR {r.crrCustomerId}
                              {r.aliases.length ? (
                                <span title={r.aliases.join(" · ")}>
                                  {" "}
                                  · +{r.aliases.length} spelling
                                  {r.aliases.length > 1 ? "s" : ""}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span title="No CRR customer resolved — this row is grouped by the party name as typed.">
                              not linked to CRR
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="num text-right">
                        {r.orders12m || <span className="text-ink-muted">—</span>}
                      </Td>
                      <Td className="num text-right font-semibold">
                        {money(r.value12m)}
                      </Td>
                      <Td>
                        {r.avgRating === null ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                            <Stars value={Math.round(r.avgRating)} />
                            <span className="num text-[12px] font-semibold">
                              {r.avgRating.toFixed(1)}
                            </span>
                            <span className="text-[11px] text-ink-muted">
                              ({r.ratedCount})
                            </span>
                          </span>
                        )}
                      </Td>
                      <Td className="text-[12px]">
                        <Trend v={r.ratingTrend} />
                      </Td>
                      <Td className="num text-right">
                        {r.openIssues ? (
                          <span className="font-semibold text-danger">
                            {r.openIssues}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </Td>
                      <Td className="num text-[12px] text-ink-soft">
                        {r.lastContacted ? (
                          formatDate(r.lastContacted)
                        ) : (
                          <span className="text-ink-muted">never</span>
                        )}
                      </Td>
                      <Td className="num text-[12px] text-ink-soft">
                        {r.lastOrderDate ? formatDate(r.lastOrderDate) : "—"}
                      </Td>
                      <Td>
                        {sig === "none" ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          <Pill tone={SIGNAL_TONE[sig]}>
                            {CUSTOMER_SIGNAL_LABEL[sig]}
                          </Pill>
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </HScroll>

        {data && data.totalPages > 1 ? (
          <div className="border-t border-line px-4 py-2.5">
            <Pager
              page={data.page}
              totalPages={data.totalPages}
              onPage={setPage}
              busy={q.isFetching}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
