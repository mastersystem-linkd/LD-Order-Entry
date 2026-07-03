import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasCap, type Capability, type Role } from "@/lib/rbac";

export type SessionUser = {
  id: string;
  role: Role;
  caps: Capability[];
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

// Capability-level RBAC for write actions (ADMIN always passes). Capabilities
// come from the session, resolved from the admin-editable Access matrix.
export async function requireCapability(cap: Capability): Promise<Guard> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user) return { ok: false, response: jsonError("Unauthorized", 401) };
  if (user.role !== "ADMIN" && !hasCap(user.caps, cap)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true, user };
}

// Passes if the user has ANY of the given capabilities (ADMIN always passes).
// For read endpoints shared by more than one page (e.g. /api/orders serves both
// the Orders list and the Operations index).
export async function requireAnyCapability(caps: Capability[]): Promise<Guard> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user) return { ok: false, response: jsonError("Unauthorized", 401) };
  if (user.role !== "ADMIN" && !caps.some((c) => hasCap(user.caps, c))) {
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
