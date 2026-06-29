import { eq } from "drizzle-orm";

import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { firstZodError, lookupUpdateSchema } from "@/lib/validation";
import { lookupValues } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/lookups/:id — edit value and/or active flag (ADMIN).
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = lookupUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const patch: { value?: string; isActive?: boolean } = {};
  if (parsed.data.value !== undefined) patch.value = parsed.data.value;
  if (parsed.data.is_active !== undefined) patch.isActive = parsed.data.is_active;

  const [updated] = await db
    .update(lookupValues)
    .set(patch)
    .where(eq(lookupValues.id, id))
    .returning({ id: lookupValues.id });
  if (!updated) return jsonError("Value not found", 404);

  return jsonData({ id });
}

// DELETE /api/lookups/:id — soft delete (is_active=false) by default, or a
// permanent delete with ?hard=1. ADMIN. Lookups aren't FK-referenced (orders
// store party/fabric as text), so a hard delete is safe.
export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const hard = new URL(req.url).searchParams.get("hard") === "1";

  if (hard) {
    const [deleted] = await db
      .delete(lookupValues)
      .where(eq(lookupValues.id, id))
      .returning({ id: lookupValues.id });
    if (!deleted) return jsonError("Value not found", 404);
    return jsonData({ id, deleted: true });
  }

  const [updated] = await db
    .update(lookupValues)
    .set({ isActive: false })
    .where(eq(lookupValues.id, id))
    .returning({ id: lookupValues.id });
  if (!updated) return jsonError("Value not found", 404);

  return jsonData({ id });
}
