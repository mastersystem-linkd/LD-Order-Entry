import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db } from "@/lib/db";
import { loadCrmConfig, loadIssues } from "@/lib/crm-query";
import { shouldEscalate } from "@/lib/crm";
import { issueCreateSchema, firstZodError } from "@/lib/validation";
import {
  crmFollowups,
  crmIssues,
  lookupValues,
  orderLineItems,
} from "@/db/schema";

// GET /api/crm/issues — the complaint board (OE-P17).
// Params: page · status (OPEN_ANY|OPEN|IN_PROGRESS|RESOLVED|REJECTED|ALL) ·
// category · severity · dept · q (order no, party, quality or design).
export async function GET(req: NextRequest) {
  const guard = await requireCapability("crm.view");
  if (!guard.ok) return guard.response;

  try {
    const data = await loadIssues(req.nextUrl.searchParams);
    return jsonData(data);
  } catch (e) {
    console.error("GET /api/crm/issues failed:", e);
    return jsonError("Could not load issues", 500);
  }
}

// POST /api/crm/issues — raise a complaint against a follow-up.
//
// quality and design_no are DENORMALIZED off the line at write time, so the
// issue still names the fabric after the line is purged (the design_database
// rule). order_line_item_id may be null — "the bill is wrong" is about the
// order, not a design.
export async function POST(req: NextRequest) {
  const guard = await requireCapability("crm.edit");
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = issueCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const p = parsed.data;

  try {
    const found = await db
      .select()
      .from(crmFollowups)
      .where(eq(crmFollowups.id, p.followup_id))
      .limit(1);
    const followup = found[0];
    if (!followup) return jsonError("Follow-up not found", 404);

    let quality: string | null = null;
    let designNo: string | null = null;
    if (p.order_line_item_id) {
      const lines = await db
        .select({
          quality: orderLineItems.quality,
          designNo: orderLineItems.designNo,
          orderId: orderLineItems.orderId,
        })
        .from(orderLineItems)
        .where(eq(orderLineItems.id, p.order_line_item_id))
        .limit(1);
      const line = lines[0];
      if (!line) return jsonError("Design line not found", 404);
      // A complaint must belong to the order being called about.
      if (line.orderId !== followup.orderId) {
        return jsonError("That design does not belong to this order", 409);
      }
      quality = line.quality;
      designNo = line.designNo;
    }

    // A category typed on the call that nobody has used before joins the
    // master list, so the next coordinator is offered it instead of inventing
    // a second spelling of the same complaint. Same idea as the party and
    // fabric dropdowns learning from what people actually type.
    await db
      .insert(lookupValues)
      .values({ category: "CRM_ISSUE", value: p.category })
      .onConflictDoNothing();

    const [issue] = await db
      .insert(crmIssues)
      .values({
        followupId: p.followup_id,
        orderId: followup.orderId,
        orderLineItemId: p.order_line_item_id ?? null,
        quality,
        designNo,
        category: p.category,
        severity: p.severity,
        ownerDept: p.owner_dept ?? null,
        qtyAffected: p.qty_affected != null ? String(p.qty_affected) : null,
        description: p.description,
        createdBy: guard.user.email ?? guard.user.name ?? null,
      })
      .returning();

    // A HIGH-severity complaint escalates the follow-up immediately — waiting
    // for the rating would hide the worst calls until the coordinator finishes.
    if (p.severity === "HIGH" && !followup.isEscalated) {
      const cfg = await loadCrmConfig();
      await db
        .update(crmFollowups)
        .set({
          isEscalated: shouldEscalate(
            followup.ratingOverall,
            true,
            cfg.escalateRatingAt,
          ),
          updatedAt: new Date(),
        })
        .where(eq(crmFollowups.id, p.followup_id));
    }

    return jsonData(issue, 201);
  } catch (e) {
    console.error("POST /api/crm/issues failed:", e);
    return jsonError("Could not raise the issue", 500);
  }
}
