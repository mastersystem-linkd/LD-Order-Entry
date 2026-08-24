"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { hasCap, type Capability } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { OrdersDashboard } from "@/components/orders/orders-dashboard";
import { OrderTracker } from "@/components/order-status/order-tracker";
import { ViewSwitch, useTrackView } from "@/components/order-status/view-switch";

// The same tracking view the Order status screen offers, on Orders too — the
// operator looking up "where is 1135?" should not have to know which of the two
// screens carries that answer.
//
// Tracking is the default here as well: when it sat behind the switch nobody
// found it, which is the whole problem this was meant to solve. The orders
// table is one click away and the choice is remembered per user, so anyone who
// prefers it only chooses once.
export function OrdersScreen({ caps }: { caps: Capability[] }) {
  const router = useRouter();
  // Storage key bumped: the earlier default here was the orders table, and a
  // stored copy of that choice would keep hiding the tracking view.
  const { view, setView } = useTrackView("oe:orders:view:v2", "track");
  const canEdit = hasCap(caps, "orders.edit");

  // "New order" lives on the orders table, so carry it into the tracking view
  // rather than making people switch back to reach it.
  const control = (
    <>
      <ViewSwitch view={view} onChange={setView} tableLabel="Orders" />
      {canEdit && view === "track" ? (
        <Button onClick={() => router.push("/orders/new")} className="shrink-0">
          <PlusIcon /> New order
        </Button>
      ) : null}
    </>
  );

  if (view === "track") return <OrderTracker toolbar={control} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{control}</div>
      <OrdersDashboard caps={caps} />
    </div>
  );
}
