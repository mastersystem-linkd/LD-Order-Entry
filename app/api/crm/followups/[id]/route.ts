import type { NextRequest } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";

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
  crmFollowupRatings,
  crmFollowups,
  crmIssues,
  crmRatingCriteria,
  customerOrders,
  lineStageProgress,
  orderLineItems,
  workflowStages,
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

    // The scores given so far, plus the criteria to render them against.
    // Both are needed: a score whose criterion has since been retired must
    // still be shown, and an unscored active criterion must still appear.
    const ratingRows = await db
      .select({
        key: crmFollowupRatings.criterionKey,
        value: crmFollowupRatings.value,
      })
      .from(crmFollowupRatings)
      .where(eq(crmFollowupRatings.followupId, id));
    const ratings: Record<string, number> = {};
    for (const r of ratingRows) ratings[r.key] = r.value;

    const criteria = await db
      .select()
      .from(crmRatingCriteria)
      .orderBy(asc(crmRatingCriteria.sortOrder), asc(crmRatingCriteria.label));

    // Which stages actually missed their deadline, and by how much. Without
    // this the panel could only say "our SLA says late" — true, unactionable,
    // and impossible for a coordinator to check. The numbers let them see
    // that dispatch ran 2 days over rather than guessing.
    const sla = await db
      .select({
        stageKey: lineStageProgress.stageKey,
        label: workflowStages.label,
        offset: workflowStages.plannedOffsetDays,
        worstDelay: sql<number>`max(${lineStageProgress.delayMinutes})`,
        plannedAt: sql<string | null>`min(${lineStageProgress.plannedAt})`,
        lastActual: sql<string | null>`max(${lineStageProgress.actualAt})`,
        done: sql<number>`count(*) filter (where ${lineStageProgress.isDone})`,
        total: sql<number>`count(*)`,
      })
      .from(lineStageProgress)
      .innerJoin(
        orderLineItems,
        eq(orderLineItems.id, lineStageProgress.orderLineItemId),
      )
      .innerJoin(
        workflowStages,
        eq(workflowStages.stageKey, lineStageProgress.stageKey),
      )
      .where(
        and(
          eq(orderLineItems.orderId, row.f.orderId),
          eq(orderLineItems.isDeleted, false),
          eq(orderLineItems.isCancelled, false),
        ),
      )
      .groupBy(
        lineStageProgress.stageKey,
        workflowStages.label,
        workflowStages.plannedOffsetDays,
        workflowStages.sortOrder,
      )
      .orderBy(asc(workflowStages.sortOrder));

    return jsonData({
      followup: row.f,
      sla: sla.map((r) => ({
        stageKey: r.stageKey,
        label: r.label,
        targetDays: r.offset,
        lateMinutes: Number(r.worstDelay ?? 0) > 0 ? Number(r.worstDelay) : 0,
        plannedAt: r.plannedAt,
        actualAt: r.lastActual,
        done: Number(r.done),
        total: Number(r.total),
      })),
      order: row.o,
      lines,
      attempts,
      issues,
      ratings,
      criteria: criteria
        // Retired criteria stay visible only where a score was actually given
        // against them, so old calls read correctly without cluttering new ones.
        .filter((c) => c.isActive || ratings[c.key] !== undefined)
        .map((c) => ({
          key: c.key,
          label: c.label,
          hint: c.hint,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
        })),
    });
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

    // Every sub-rating AFTER this patch, so the overall is re-derived from the
    // whole picture rather than from whichever star happened to be clicked.
    // Criteria are configurable rows now (§12.4), so this is a map, not four
    // named fields.
    const stored = await db
      .select({
        key: crmFollowupRatings.criterionKey,
        value: crmFollowupRatings.value,
      })
      .from(crmFollowupRatings)
      .where(eq(crmFollowupRatings.followupId, id));

    const subs: Record<string, number | null> = {};
    for (const r of stored) subs[r.key] = r.value;
    for (const [k, v] of Object.entries(p.ratings ?? {})) {
      if (v === null || v === undefined) delete subs[k];
      else subs[k] = v;
    }
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

    // Persist the sub-scores. Written after the header so a rejected status
    // change (an incomplete rating, say) cannot leave scores behind for a
    // follow-up that did not move.
    for (const [key, value] of Object.entries(p.ratings ?? {})) {
      if (value === null || value === undefined) {
        await db
          .delete(crmFollowupRatings)
          .where(
            and(
              eq(crmFollowupRatings.followupId, id),
              eq(crmFollowupRatings.criterionKey, key),
            ),
          );
      } else {
        await db
          .insert(crmFollowupRatings)
          .values({ followupId: id, criterionKey: key, value })
          .onConflictDoUpdate({
            target: [
              crmFollowupRatings.followupId,
              crmFollowupRatings.criterionKey,
            ],
            set: { value },
          });
      }
    }

    return jsonData({ ...updated, ratings: subs });
  } catch (e) {
    console.error("PATCH /api/crm/followups/[id] failed:", e);
    return jsonError("Could not save the follow-up", 500);
  }
}
