import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireCapability } from "@/lib/api";
import { db, dbx } from "@/lib/db";
import { statusAfterAttempt, type AttemptOutcome, type FollowupStatus } from "@/lib/crm";
import { loadCrmConfig } from "@/lib/crm-query";
import { followupAttemptSchema, firstZodError } from "@/lib/validation";
import { crmFollowupAttempts, crmFollowups } from "@/db/schema";

// POST /api/crm/followups/:id/attempts — log one call, answered or not.
//
// The unanswered ones are the point: without them, "no complaints this month"
// is indistinguishable from "nobody called anyone" (§12.7).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCapability("crm.edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = followupAttemptSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const { channel, outcome, note } = parsed.data;

  try {
    const cfg = await loadCrmConfig();
    const existing = await db
      .select()
      .from(crmFollowups)
      .where(eq(crmFollowups.id, id))
      .limit(1);
    const cur = existing[0];
    if (!cur) return jsonError("Follow-up not found", 404);

    const attemptCount = cur.attemptCount + 1;
    const status = statusAfterAttempt(
      cur.status as FollowupStatus,
      attemptCount,
      outcome as AttemptOutcome,
      cfg.maxAttempts,
    );
    const now = new Date();

    // One transaction: the attempt row and the counter it drives must not be
    // able to disagree. postgres.js pins a connection for an interactive
    // transaction, so this is kept as short as possible.
    const result = await dbx.transaction(async (tx) => {
      const [attempt] = await tx
        .insert(crmFollowupAttempts)
        .values({
          followupId: id,
          channel,
          outcome,
          note,
          attemptedAt: now,
          createdBy: guard.user.email ?? guard.user.name ?? null,
        })
        .returning();

      const [followup] = await tx
        .update(crmFollowups)
        .set({
          attemptCount,
          status,
          // First contact is what "contacted" means for the coverage metric —
          // not the completion of the call.
          contactedAt:
            outcome === "connected" && !cur.contactedAt ? now : cur.contactedAt,
          updatedAt: now,
        })
        .where(eq(crmFollowups.id, id))
        .returning();

      return { attempt, followup };
    });

    return jsonData(result, 201);
  } catch (e) {
    console.error("POST /api/crm/followups/[id]/attempts failed:", e);
    return jsonError("Could not log the attempt", 500);
  }
}
