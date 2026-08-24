"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import type { Capability } from "@/lib/rbac";
import { OrderStatusBoard } from "@/components/order-status/order-status-board";
import { OrderTracker } from "@/components/order-status/order-tracker";
import { ViewSwitch, useTrackView } from "@/components/order-status/view-switch";

// Two ways to read the same data, side by side rather than one replacing the
// other: the tracking view answers "where is this order?", the board stays
// exactly as it was for the filtering, column-picking and CSV work built on it.
export function OrderStatusScreen({
  caps,
  userKey,
}: {
  caps: Capability[];
  userKey?: string;
}) {
  const params = useSearchParams();
  const { view, setView } = useTrackView(
    `oe:order-status:view:${userKey ?? "anon"}`,
  );

  // A deep link that carries a board filter (from the Dashboard KPIs) means the
  // board is what was asked for — honour it over the remembered choice.
  const deepLinked =
    params.get("overall") || params.get("stage") || params.get("cancelled");
  const effective = deepLinked ? "table" : view;

  const control = (
    <ViewSwitch view={effective} onChange={setView} tableLabel="Board" />
  );

  if (effective === "track") {
    return (
      <OrderTracker initialSearch={params.get("search") ?? ""} toolbar={control} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{control}</div>
      <OrderStatusBoard caps={caps} userKey={userKey} />
    </div>
  );
}
