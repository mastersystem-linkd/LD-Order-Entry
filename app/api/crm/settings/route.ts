import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { crmSettings } from "@/db/schema";
import { crmSettingsUpdateSchema, firstZodError } from "@/lib/validation";

// CRM tuning knobs (CLAUDE.md §12.2). ADMIN-only, like every other Settings
// surface — these change when a follow-up is created and when one escalates,
// so they are not a coordinator's to edit.
//
// crm_settings holds exactly one row, created by migration 0003. Both handlers
// read it by "first row" rather than by a known id, because the id is random
// and nothing else references it.

async function firstRow() {
  const [row] = await db.select().from(crmSettings).limit(1);
  return row ?? null;
}

function shape(row: NonNullable<Awaited<ReturnType<typeof firstRow>>>) {
  return {
    transit_days_default: row.transitDaysDefault,
    followup_due_days: row.followupDueDays,
    max_attempts: row.maxAttempts,
    escalate_rating_at: row.escalateRatingAt,
    auto_create_followups: row.autoCreateFollowups,
    transport_transit_days: row.transportTransitDays as Record<
      string,
      number
    > | null,
    updated_at: row.updatedAt,
  };
}

// GET /api/crm/settings
export async function GET() {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const row = await firstRow();
  if (!row) return jsonError("CRM settings row is missing", 500);
  return jsonData(shape(row));
}

// PATCH /api/crm/settings — partial update; the form sends only what changed.
export async function PATCH(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = crmSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const row = await firstRow();
  if (!row) return jsonError("CRM settings row is missing", 500);

  const d = parsed.data;
  const patch: Partial<typeof crmSettings.$inferInsert> = { updatedAt: new Date() };
  if (d.transit_days_default !== undefined)
    patch.transitDaysDefault = d.transit_days_default;
  if (d.followup_due_days !== undefined)
    patch.followupDueDays = d.followup_due_days;
  if (d.max_attempts !== undefined) patch.maxAttempts = d.max_attempts;
  if (d.escalate_rating_at !== undefined)
    patch.escalateRatingAt = d.escalate_rating_at;
  if (d.auto_create_followups !== undefined)
    patch.autoCreateFollowups = d.auto_create_followups;
  if (d.transport_transit_days !== undefined)
    patch.transportTransitDays = d.transport_transit_days;

  await db.update(crmSettings).set(patch);

  const after = await firstRow();
  return jsonData(after ? shape(after) : null);
}
