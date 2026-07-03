import bcrypt from "bcryptjs";
import { and, count, eq, ne } from "drizzle-orm";

import {
  isUniqueViolation,
  jsonData,
  jsonError,
  requireRole,
} from "@/lib/api";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { firstZodError, userUpdateSchema } from "@/lib/validation";
import { users } from "@/db/schema";

type Params = { params: Promise<{ id: string }> };

// Active admins other than `exceptId`. Guards against locking everyone out.
async function otherActiveAdmins(exceptId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.isActive, true),
        ne(users.id, exceptId),
      ),
    );
  return n;
}

// PATCH /api/users/:id — change role, active flag, name, or reset password.
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = userUpdateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);
  const { email, name, role, is_active, password } = parsed.data;

  const [target] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) return jsonError("User not found", 404);

  // Email change → normalize + reject if taken by another account.
  let normalizedEmail: string | undefined;
  if (email !== undefined) {
    normalizedEmail = normalizeEmail(email);
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, normalizedEmail), ne(users.id, id)))
      .limit(1);
    if (clash) {
      return jsonError(`A user with email "${normalizedEmail}" already exists.`, 409);
    }
  }

  const isSelf = id === guard.user.id;
  if (isSelf && is_active === false) {
    return jsonError("You can't deactivate your own account.", 409);
  }
  if (isSelf && role !== undefined && role !== "ADMIN") {
    return jsonError("You can't change your own role.", 409);
  }

  // Don't allow removing the last active admin (by demotion or deactivation).
  const losingAdmin =
    target.role === "ADMIN" &&
    target.isActive &&
    ((role !== undefined && role !== "ADMIN") || is_active === false);
  if (losingAdmin && (await otherActiveAdmins(id)) === 0) {
    return jsonError("At least one active admin must remain.", 409);
  }

  const patch: {
    email?: string;
    name?: string | null;
    role?: "ADMIN" | "MANAGER" | "SALES" | "OPS" | "VIEWER";
    isActive?: boolean;
    passwordHash?: string;
  } = {};
  if (normalizedEmail !== undefined) patch.email = normalizedEmail;
  if (name !== undefined) patch.name = name;
  if (role !== undefined) patch.role = role;
  if (is_active !== undefined) patch.isActive = is_active;
  if (password !== undefined) patch.passwordHash = await bcrypt.hash(password, 10);

  try {
    await db.update(users).set(patch).where(eq(users.id, id));
  } catch (e) {
    if (isUniqueViolation(e)) {
      return jsonError("A user with that email already exists.", 409);
    }
    throw e;
  }
  return jsonData({ id });
}

// DELETE /api/users/:id — permanently remove an account (ADMIN only).
export async function DELETE(_req: Request, { params }: Params) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  if (id === guard.user.id) {
    return jsonError("You can't delete your own account.", 409);
  }

  const [target] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) return jsonError("User not found", 404);

  if (
    target.role === "ADMIN" &&
    target.isActive &&
    (await otherActiveAdmins(id)) === 0
  ) {
    return jsonError("At least one active admin must remain.", 409);
  }

  await db.delete(users).where(eq(users.id, id));
  return jsonData({ id });
}
