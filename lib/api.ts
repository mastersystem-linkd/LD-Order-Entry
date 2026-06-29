import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";

export type SessionUser = {
  id: string;
  role: Role;
  email?: string | null;
  name?: string | null;
};

// Standard envelopes (CLAUDE.md §8): success `{ data }`, error `{ error }`.
export function jsonData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}
export function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export type Guard =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

// Route-level RBAC. Middleware already requires a session for /api, but role
// enforcement for specific actions happens here.
export async function requireRole(roles: Role[]): Promise<Guard> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user) return { ok: false, response: jsonError("Unauthorized", 401) };
  if (!roles.includes(user.role)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true, user };
}

// Postgres unique_violation — used to turn a race on order_no into a clean 409.
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}
