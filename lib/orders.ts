// Shared client/server types + pure helpers for orders. No server-only imports
// here (this is consumed by client components).

import type { OperationsStatus } from "@/components/ui/status-badge";

export type { OperationsStatus };

// Row shape returned by GET /api/orders (dashboard list).
export type OrderRow = {
  id: string;
  order_no: string;
  order_date: string;
  party_name: string;
  sales_person: string | null;
  agent: string | null;
  haste: string | null;
  challan_no: string | null;
  lot_no: string | null;
  department: string | null;
  fabrics: string[];
  line_count: number;
  qty_total: number;
  grand_total: number;
  operations_status: OperationsStatus;
  created_at: string;
};

export type OrdersList = {
  orders: OrderRow[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

// Fabric block as reconstructed by GET /api/orders/:id and posted back on save.
export type FabricBlock = {
  fabric: string;
  rate: number | null;
  designs: { design_no: string; qty_mtr: number }[];
};

export type OrderLine = {
  id: string;
  quality: string;
  design_no: string;
  qty_mtr: string;
  rate: string | null;
  line_total: string | null;
  is_cancelled: boolean;
  operations_status: OperationsStatus;
};

export type OrderDetail = {
  order: {
    id: string;
    order_no: string;
    order_date: string;
    party_name: string;
    sales_person: string | null;
    agent: string | null;
    haste: string | null;
    transport: string | null;
    challan_no: string | null;
    lot_no: string | null;
    department: string | null;
    remarks: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  fabrics: FabricBlock[];
  lines: OrderLine[];
  qty_total: number;
  grand_total: number;
  operations_status: OperationsStatus;
};

// ---- OE-P3 operations tracking ----
export type StockStatus = "in_stock" | "out_of_stock";

export type TrackingStage = {
  stage_key: string;
  label: string;
  planned_at: string | null;
  actual_at: string | null;
  is_done: boolean;
  delay_minutes: number | null;
  updated_at: string;
  // Only set on the stock_checking stage (null elsewhere / undecided).
  stock_status: StockStatus | null;
};

export type TrackingLine = {
  id: string;
  quality: string;
  design_no: string;
  qty_mtr: string;
  rate: string | null;
  line_total: string | null;
  is_cancelled: boolean;
  operations_status: OperationsStatus;
  stages: TrackingStage[];
};

export type OrderTracking = {
  order: {
    id: string;
    order_no: string;
    order_date: string;
    party_name: string;
    sales_person: string | null;
    agent: string | null;
    haste: string | null;
    department: string | null;
    challan_no: string | null;
    lot_no: string | null;
  };
  stage_keys: string[];
  lines: TrackingLine[];
  operations_status: OperationsStatus;
};

// Indian-style number formatting for money/qty display.
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Date only, e.g. "30 Jun". Null-safe.
export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
  }).format(d);
}

// Compact date+time, e.g. "29 Jun, 14:30". Null-safe.
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

// Human delay, e.g. 0 → "On time", 45 → "+45m", 130 → "+2h 10m".
export function formatDelay(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes <= 0) return "On time";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `+${h}h${m ? ` ${m}m` : ""}` : `+${m}m`;
}
