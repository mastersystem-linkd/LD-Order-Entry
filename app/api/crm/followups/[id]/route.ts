import type { NextRequest } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import {
  canComplete,
  deriveOverallRating,
  shouldEscalate,
  type FollowupStatus,
} from "@/lib/crm";
import { loadCrmConfig } from "@/lib/crm-query";
import { followupUpdateSchema, firstZodError } from "@/lib/validation";
import {
  crmFollowupAttempts,
  crmFollowups,
  crmIssues,
  customerOrders,
  orderLineItems,
} from "@/db/schema";

// GET /api/crm/followups/:id — everything the call panel needs in one round
// trip: the follow-up, the order it belongs to, that order's design lines (so
// an issue can be pinned to a quality/design), the attempts logged so far, and
// the issues already raised.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    const rows = await db
      .select({ f: crmFollowups, o: customerOrders })
      .from(crmFollowups)
      .innerJoin(customerOrders, eq(customerOrders.id, crmFollowups.orderId))
      .where(eq(crmFollowups.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return jsonError("Follow-up not found", 404);

    // Three small reads, sequential — well inside the ≤4 fan-out rule, and the
    // pool is the scarce resource here, not the round trips.
    const lines = await db
      .select({
        id: orderLineItems.id,
        quality: orderLineItems.quality,
        designNo: orderLineItems.designNo,
        qtyMtr: orderLineItems.qtyMtr,
        isCancelled: orderLineItems.isCancelled,
      })
      .from(orderLineItems)
      .where(
        and(
          eq(orderLineItems.orderId, row.f.orderId),
          eq(orderLineItems.isDeleted, false),
        ),
      )
      .orderBy(asc(orderLineItems.quality), asc(orderLineItems.designNo));

    const attempts = await db
      .select()
      .from(crmFollowupAttempts)
      .where(eq(crmFollowupAttempts.followupId, id))
      .orderBy(desc(crmFollowupAttempts.attemptedAt));

    const issues = await db
      .select()
      .from(crmIssues)
      .where(eq(crmIssues.followupId, id))
      .orderBy(asc(crmIssues.createdAt));

    return jsonData({ followup: row.f, order: row.o, lines, attempts, issues });
  } catch (e) {
    console.error("GET /api/crm/followups/[id] failed:", e);
    return jsonError("Could not load the follow-up", 500);
  }
}

// PATCH /api/crm/followups/:id — the call itself.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability("crm.edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = followupUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const p = parsed.data;

  try {
    const existing = await db
      .select()
      .from(crmFollowups)
      .where(eq(crmFollowups.id, id))
      .limit(1);
    const cur = existing[0];
    if (!cur) return jsonError("Follow-up not found", 404);

    // The four sub-ratings after this patch, so the overall can be re-derived
    // from the whole picture rather than from the field that happened to change.
    const subs = {
      delivery: p.rating_delivery !== undefined ? p.rating_delivery : cur.ratingDelivery,
      quality: p.rating_quality !== undefined ? p.rating_quality : cur.ratingQuality,
      packing: p.rating_packing !== undefined ? p.rating_packing : cur.ratingPacking,
      coordination:
        p.rating_coordination !== undefined
          ? p.rating_coordination
          : cur.ratingCoordination,
    };
    // An explicit overall always wins — it is the coordinator's override, and
    // rating_source records that it was theirs. Otherwise it follows the mean.
    const overall =
      p.rating_overall !== undefined
        ? p.rating_overall
        : (deriveOverallRating(subs) ?? cur.ratingOverall);

    const status = (p.status ?? cur.status) as FollowupStatus;
    if (status === "COMPLETED" && !canComplete(overall ?? null)) {
      // Mirrors ck_crm_followups_completed_rating — caught here so the operator
      // gets a sentence instead of a constraint-violation 500.
      return jsonError(
        "An overall rating is required to complete a follow-up",
        409,
      );
    }

    const cfg = await loadCrmConfig();
    const high = await db
      .select({ id: crmIssues.id })
      .from(crmIssues)
      .where(and(eq(crmIssues.followupId, id), eq(crmIssues.severity, "HIGH")))
      .limit(1);

    const now = new Date();
    const actor = guard.user.email ?? guard.user.name ?? null;

    const [updated] = await db
      .update(crmFollowups)
      .set({
        status,
        contactPerson:
          p.contact_person !== undefined ? p.contact_person : cur.contactPerson,
        contactPhone:
          p.contact_phone !== undefined ? p.contact_phone : cur.contactPhone,
        customerSaysOnTime:
          p.customer_says_on_time !== undefined
            ? p.customer_says_on_time
            : cur.customerSaysOnTime,
        delayReason: p.delay_reason !== undefined ? p.delay_reason : cur.delayReason,
        ratingDelivery: subs.delivery,
        ratingQuality: subs.quality,
        ratingPacking: subs.packing,
        ratingCoordination: subs.coordination,
        ratingOverall: overall,
        ratingSource: p.rating_source !== undefined ? p.rating_source : cur.ratingSource,
        reorderIntent: p.reorder_intent ?? cur.reorderIntent,
        reorderNote: p.reorder_note !== undefined ? p.reorder_note : cur.reorderNote,
        notes: p.notes !== undefined ? p.notes : cur.notes,
        assignedTo: p.assigned_to !== undefined ? p.assigned_to : cur.assignedTo,
        isEscalated: shouldEscalate(
          overall ?? null,
          high.length > 0,
          cfg.escalateRatingAt,
        ),
        // Stamped once, when the follow-up first reaches a terminal state.
        contactedAt:
          status === "COMPLETED" && !cur.contactedAt ? now : cur.contactedAt,
        completedBy: status === "COMPLETED" ? actor : cur.completedBy,
        updatedAt: now,
      })
      .where(eq(crmFollowups.id, id))
      .returning();

    return jsonData(updated);
  } catch (e) {
    console.error("PATCH /api/crm/followups/[id] failed:", e);
    return jsonError("Could not save the follow-up", 500);
  }
}
