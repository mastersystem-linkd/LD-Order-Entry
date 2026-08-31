import type { NextRequest } from "next/server";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { loadCrmAnalytics } from "@/lib/crm-query";

// GET /api/crm/analytics — what the follow-up work adds up to (§12.5.5).
// Params: from · to (a window on the delivery date, the event a call is about).
export async function GET(req: NextRequest) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  try {
    const data = await loadCrmAnalytics(req.nextUrl.searchParams);
    return jsonData(data);
  } catch (e) {
    console.error("GET /api/crm/analytics failed:", e);
    return jsonError("Could not load CRM analytics", 500);
  }
}
