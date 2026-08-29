import type { NextRequest } from "next/server";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { loadFollowups } from "@/lib/crm-query";

// GET /api/crm/followups — the priority-ranked follow-up queue (CLAUDE.md §12).
//
// This read also RECONCILES: it creates follow-up rows for orders that have
// become delivered since the last look (§12.9). That is deliberate and it is
// the only creation path — there is no scheduler in this app, and a manual
// "create follow-up" button would let the queue silently under-report by simply
// not being pressed. The insert is idempotent (unique order_id +
// onConflictDoNothing), bounded, and skipped entirely when
// crm_settings.auto_create_followups is false.
//
// Params: page · sort (priority|oldest|value) · status · q (order no or party)
// · transport · assigned · from · to.
export async function GET(req: NextRequest) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  try {
    const data = await loadFollowups(req.nextUrl.searchParams);
    return jsonData(data);
  } catch (e) {
    console.error("GET /api/crm/followups failed:", e);
    return jsonError("Could not load the follow-up queue", 500);
  }
}
