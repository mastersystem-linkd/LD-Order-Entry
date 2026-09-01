import type { NextRequest } from "next/server";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { loadCalls } from "@/lib/crm-query";

// GET /api/crm/calls — the record of what customers actually said (§12.5.6).
//
// Read-only. Feedback, the per-criterion scores and the reorder note were all
// written by the call panel and readable nowhere else; complaints had a board
// and the rest of the call had nothing.
//
// Params: page · q (order, party, feedback text, reorder note) · from · to ·
// has (feedback|reorder|rating).
export async function GET(req: NextRequest) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  try {
    const data = await loadCalls(req.nextUrl.searchParams);
    return jsonData(data);
  } catch (e) {
    console.error("GET /api/crm/calls failed:", e);
    return jsonError("Could not load the call log", 500);
  }
}
