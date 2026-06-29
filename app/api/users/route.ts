import bcrypt from "bcryptjs";
import { asc, eq } from "drizzle-orm";

import {
  isUniqueViolation,
  jsonData,
  jsonError,
  requireRole,
} from "@/lib/api";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { firstZodError, userCreateSchema } from "@/lib/validation";
import { users } from "@/db/schema";

// GET /api/users — list all accounts for the access manager (ADMIN only).
export async function GET() {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      is_active: users.isActive,
      created_at: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.email));

  return jsonData({ users: rows, current_user_id: guard.user.id });
}

// POST /api/users — create an account and grant a role (ADMIN only).
export async function POST(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success) return jsonError(firstZodError(parsed.error), 422);

  const email = normalizeEmail(parsed.data.email);

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (dup) return jsonError(`A user with email "${email}" already exists.`, 409);

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: parsed.data.name ?? null,
        role: parsed.data.role,
        passwordHash,
        isActive: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        is_active: users.isActive,
      });
    return jsonData(created, 201);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return jsonError(`A user with email "${email}" already exists.`, 409);
    }
    console.error("POST /api/users failed:", e);
    return jsonError("Failed to create user", 500);
  }
}
