import { z } from "zod";

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

// First human-readable message from a ZodError, for { error } responses.
export function firstZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
