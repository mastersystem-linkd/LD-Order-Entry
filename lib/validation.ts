import { z } from "zod";

import { STAGE_KEYS } from "@/lib/workflow";
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
const USER_ROLES = ["ADMIN", "MANAGER", "SALES", "OPS", "VIEWER"] as const;

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

// First human-readable message from a ZodError, for { error } responses.
export function firstZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
