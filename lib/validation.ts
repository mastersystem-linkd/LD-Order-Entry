import { z } from "zod";

import { STAGE_KEYS } from "@/lib/workflow";
import {
  ATTEMPT_CHANNELS,
  ATTEMPT_OUTCOMES,
  DELAY_REASONS,
  FOLLOWUP_STATUSES,
  ISSUE_RESOLUTIONS,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  OWNER_DEPTS,
  RATING_SOURCES,
  REORDER_INTENTS,
} from "@/lib/crm";
import { LOOKUP_CATEGORIES } from "@/db/schema";

// Payload for POST /api/orders and PUT /api/orders/:id.
// Mirrors the order entry form: one header + repeatable fabric blocks, each with
// a rate and repeatable design rows. order_no/quality/design_no stay text.

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const designSchema = z.object({
  design_no: z.string().trim().min(1, "Design no is required").max(100),
  qty_mtr: z.coerce.number().positive("Qty must be greater than 0"),
});

const fabricSchema = z.object({
  fabric: z.string().trim().min(1, "Fabric is required").max(100),
  rate: z.coerce.number().nonnegative("Rate cannot be negative").nullable().optional(),
  designs: z.array(designSchema).min(1, "Add at least one design"),
});

const orderHeaderSchema = z.object({
  order_no: z.string().trim().min(1, "Order no is required").max(50),
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Order date must be YYYY-MM-DD"),
  party_name: z.string().trim().min(1, "Party is required").max(200),
  sales_person: optionalText,
  agent: optionalText,
  haste: optionalText,
  transport: optionalText,
  challan_no: optionalText,
  lot_no: optionalText,
  department: z.string().trim().max(40).optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
});

export const orderPayloadSchema = z.object({
  order: orderHeaderSchema,
  fabrics: z.array(fabricSchema).min(1, "Add at least one fabric block"),
});

export type OrderPayload = z.infer<typeof orderPayloadSchema>;

// PATCH /api/tracking/stage — tick/untick one stage on one line item (OE-P3).
export const stageToggleSchema = z.object({
  line_item_id: z.string().uuid("line_item_id must be a UUID"),
  stage_key: z.enum(STAGE_KEYS),
  checked: z.boolean(),
  // Only for stage_key === "stock_checking": the chosen stock outcome.
  stock_status: z.enum(["in_stock", "out_of_stock"]).nullable().optional(),
  planned: z.string().datetime({ offset: true }).optional().nullable(),
  actual: z.string().datetime({ offset: true }).optional().nullable(),
});

export type StageTogglePayload = z.infer<typeof stageToggleSchema>;

// PATCH /api/orders/:id/cancel — cancel/restore one design (line_id) or the
// whole order (line_id omitted). Reversible via `cancelled`.
export const cancelOrderSchema = z.object({
  line_id: z.string().uuid("line_id must be a UUID").optional().nullable(),
  cancelled: z.boolean(),
});

export type CancelOrderPayload = z.infer<typeof cancelOrderSchema>;

// PATCH /api/orders/:id/delete — soft-delete/restore one design (line_id) or the
// whole order (line_id omitted). Reversible via `deleted`; a deleted line is
// hidden from every normal view and recoverable from Trash.
export const deleteLineSchema = z.object({
  line_id: z.string().uuid("line_id must be a UUID").optional().nullable(),
  deleted: z.boolean(),
});

export type DeleteLinePayload = z.infer<typeof deleteLineSchema>;

// ---- OE-P5 Settings / master data ----

export const lookupCreateSchema = z.object({
  category: z.enum(LOOKUP_CATEGORIES),
  value: z.string().trim().min(1, "Value is required").max(200),
});

export const lookupUpdateSchema = z
  .object({
    value: z.string().trim().min(1).max(200).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => d.value !== undefined || d.is_active !== undefined, {
    message: "Nothing to update",
  });

export const lookupBulkSchema = z.object({
  category: z.enum(LOOKUP_CATEGORIES),
  values: z.array(z.string()).min(1, "Paste at least one value"),
});

export const lookupBulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one value"),
  hard: z.boolean().optional(),
});

export const stageUpdateSchema = z.object({
  planned_offset_days: z.coerce
    .number()
    .int("Must be a whole number")
    .min(0, "Cannot be negative")
    .max(365, "Too large"),
});

// ---- User access management (admin) ----
// Kept in step with ROLES in lib/rbac.ts by hand — zod needs a literal tuple,
// and rbac.ts must stay free of Node-only imports for the edge middleware.
// If you add a role there, add it here, or it cannot be assigned to a user.
const USER_ROLES = ["ADMIN", "SALES", "OPS", "VIEWER", "CRM"] as const;

export const userCreateSchema = z.object({
  email: z.string().trim().email("A valid email is required").max(255),
  name: z.string().trim().max(200).optional().nullable(),
  role: z.enum(USER_ROLES),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200),
});

export const userUpdateSchema = z
  .object({
    email: z.string().trim().email("A valid email is required").max(255).optional(),
    name: z.string().trim().max(200).optional().nullable(),
    role: z.enum(USER_ROLES).optional(),
    is_active: z.boolean().optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(200)
      .optional(),
  })
  .refine(
    (d) =>
      d.email !== undefined ||
      d.name !== undefined ||
      d.role !== undefined ||
      d.is_active !== undefined ||
      d.password !== undefined,
    { message: "Nothing to update" },
  );

// ---- CRM: post-delivery follow-up (CLAUDE.md §12) ----------------------------
// Every CRM write goes through one of these. The vocabularies come from
// lib/crm.ts so the database, the API and the UI cannot drift apart.

const star = z.coerce.number().int().min(1).max(5);
const crmNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

// PATCH /api/crm/followups/:id — the call itself. Every field optional: the
// panel autosaves as the coordinator works, so a partial payload is normal.
export const followupUpdateSchema = z
  .object({
    status: z.enum(FOLLOWUP_STATUSES).optional(),
    contact_person: z.string().trim().max(120).optional().nullable(),
    contact_phone: z.string().trim().max(30).optional().nullable(),
    customer_says_on_time: z.boolean().optional().nullable(),
    delay_reason: z.enum(DELAY_REASONS).optional().nullable(),
    // Scores by criterion key (§12.4). Criteria are configurable rows, so
    // this cannot be a fixed set of named fields. A null clears one.
    ratings: z.record(z.string().max(40), star.nullable()).optional(),
    rating_overall: star.optional().nullable(),
    rating_source: z.enum(RATING_SOURCES).optional().nullable(),
    reorder_intent: z.enum(REORDER_INTENTS).optional(),
    reorder_note: crmNote,
    notes: crmNote,
    assigned_to: z.string().uuid().optional().nullable(),
  })
  // NOT_REQUIRED always needs a reason on the record (§12). Without this the
  // row silently leaves the queue with no account of why.
  .refine((d) => d.status !== "NOT_REQUIRED" || !!d.notes, {
    message: "A reason note is required to mark a follow-up not required",
    path: ["notes"],
  })
  // COMPLETED requires a score, mirrored by ck_crm_followups_completed_rating.
  .refine((d) => d.status !== "COMPLETED" || d.rating_overall != null, {
    message: "An overall rating is required to complete a follow-up",
    path: ["rating_overall"],
  });
export type FollowupUpdateInput = z.infer<typeof followupUpdateSchema>;

// POST /api/crm/followups/:id/attempts — one logged call, answered or not.
export const followupAttemptSchema = z.object({
  channel: z.enum(ATTEMPT_CHANNELS),
  outcome: z.enum(ATTEMPT_OUTCOMES),
  note: crmNote,
});
export type FollowupAttemptInput = z.infer<typeof followupAttemptSchema>;

// POST /api/crm/issues — a complaint. order_line_item_id is nullable because a
// customer can complain about the order as a whole ("the bill is wrong"), but
// quality/design are captured whenever a line IS named so the issue survives a
// line purge.
export const issueCreateSchema = z.object({
  followup_id: z.string().uuid(),
  order_line_item_id: z.string().uuid().optional().nullable(),
  // Free text, drawn from lookup_values("CRM_ISSUE") — a customer complains
  // about whatever they complain about, and an unknown value is never blocked
  // (§3.4). The API adds a genuinely new one to the master list.
  category: z.string().trim().min(1, "A category is required").max(100),
  severity: z.enum(ISSUE_SEVERITIES),
  owner_dept: z.enum(OWNER_DEPTS).optional().nullable(),
  qty_affected: z.coerce.number().min(0).max(99999999).optional().nullable(),
  description: crmNote,
});
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;

// PATCH /api/crm/issues/:id — triage and resolution.
export const issueUpdateSchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    severity: z.enum(ISSUE_SEVERITIES).optional(),
    owner_dept: z.enum(OWNER_DEPTS).optional().nullable(),
    qty_affected: z.coerce.number().min(0).max(99999999).optional().nullable(),
    description: crmNote,
    status: z.enum(ISSUE_STATUSES).optional(),
    resolution: z.enum(ISSUE_RESOLUTIONS).optional().nullable(),
    resolution_note: crmNote,
  })
  // Closing an issue without saying how it was closed is how a complaint log
  // becomes a list nobody trusts.
  .refine((d) => d.status !== "RESOLVED" || !!d.resolution, {
    message: "A resolution is required to resolve an issue",
    path: ["resolution"],
  });
export type IssueUpdateInput = z.infer<typeof issueUpdateSchema>;

// Rating criteria (§12.4) — ADMIN, Settings → CRM. `key` is accepted on
// create only and frozen thereafter: crm_followup_ratings references it, so
// re-keying would orphan every score already given.
export const ratingCriterionCreateSchema = z.object({
  label: z.string().trim().min(1, "A name is required").max(80),
  hint: z.string().trim().max(160).optional().nullable().transform((v) => (v ? v : null)),
  key: z.string().trim().max(40).optional(),
});
export type RatingCriterionCreateInput = z.infer<typeof ratingCriterionCreateSchema>;

export const ratingCriterionUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    hint: z.string().trim().max(160).optional().nullable().transform((v) => (v ? v : null)),
    sort_order: z.coerce.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });
export type RatingCriterionUpdateInput = z.infer<typeof ratingCriterionUpdateSchema>;

// PATCH /api/crm/settings — ADMIN only, like every other Settings surface.
export const crmSettingsUpdateSchema = z
  .object({
    transit_days_default: z.coerce.number().int().min(0).max(60).optional(),
    followup_due_days: z.coerce.number().int().min(0).max(60).optional(),
    max_attempts: z.coerce.number().int().min(1).max(10).optional(),
    escalate_rating_at: z.coerce.number().int().min(1).max(5).optional(),
    auto_create_followups: z.boolean().optional(),
    transport_transit_days: z
      .record(z.string(), z.coerce.number().int().min(0).max(60))
      .optional()
      .nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update" });
export type CrmSettingsUpdateInput = z.infer<typeof crmSettingsUpdateSchema>;

// First human-readable message from a ZodError, for { error } responses.
export function firstZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
