import type { NextRequest } from "next/server";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { loadCustomers } from "@/lib/crm-query";

// GET /api/crm/customers — the read-only customer roll-up (CLAUDE.md §12.5.4).
//
// Read-only by design: this is a VIEW over orders, follow-ups and issues, not a
// second customer master. There is deliberately no POST/PATCH here — a party
// name is only ever changed on the order that carries it.
//
// Params: page · sort (value|rating|issues|orders|name) · rated (low|high) · q.
export async function GET(req: NextRequest) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  try {
    const data = await loadCustomers(req.nextUrl.searchParams);
    return jsonData(data);
  } catch (e) {
    console.error("GET /api/crm/customers failed:", e);
    return jsonError("Could not load customers", 500);
  }
}
