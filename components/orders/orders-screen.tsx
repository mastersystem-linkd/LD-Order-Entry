"use client";

import * as React from "react";

import type { Capability } from "@/lib/rbac";
import { OrdersDashboard } from "@/components/orders/orders-dashboard";
import { OrderTracker } from "@/components/order-status/order-tracker";
import { ViewSwitch, useTrackView } from "@/components/order-status/view-switch";

// The same tracking view the Order status screen offers, on Orders too — the
// operator who is looking up "where is 1135?" should not have to know which of
// the two screens carries that answer. The orders table is untouched behind the
// switch.
export function OrdersScreen({ caps }: { caps: Capability[] }) {
  const { view, setView } = useTrackView("oe:orders:view", "table");
  const control = <ViewSwitch view={view} onChange={setView} tableLabel="Orders" />;

  if (view === "track") return <OrderTracker toolbar={control} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{control}</div>
      <OrdersDashboard caps={caps} />
    </div>
  );
}
