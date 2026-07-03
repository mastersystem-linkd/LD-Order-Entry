import { jsonData, jsonError, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import {
  CAPABILITY_KEYS,
  DEFAULT_ROLE_CAPS,
  EDITABLE_ROLES,
  type Capability,
  type Role,
} from "@/lib/rbac";
import { rolePermissions } from "@/db/schema";

// GET /api/access — the editable role × capability grant matrix (ADMIN only).
// ADMIN is never included (always full). Any (role, capability) with no stored
// row falls back to the code default so the matrix is always complete.
export async function GET() {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const rows = await db
    .select({
      role: rolePermissions.role,
      capability: rolePermissions.capability,
      allowed: rolePermissions.allowed,
    })
    .from(rolePermissions);

  const stored = new Map<string, boolean>();
  for (const r of rows) stored.set(`${r.role}:${r.capability}`, r.allowed);

  const grants: Record<string, Record<string, boolean>> = {};
  for (const role of EDITABLE_ROLES) {
    grants[role] = {};
    for (const cap of CAPABILITY_KEYS) {
      const key = `${role}:${cap}`;
      grants[role][cap] = stored.has(key)
        ? stored.get(key)!
        : DEFAULT_ROLE_CAPS[role].includes(cap);
    }
  }
  return jsonData({ grants });
}

// PUT /api/access — toggle one (role, capability) grant (ADMIN only). ADMIN is
// not editable. Change takes effect on the affected users' next login.
export async function PUT(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    role?: string;
    capability?: string;
    allowed?: unknown;
  } | null;
  const role = body?.role as Role | undefined;
  const capability = body?.capability as Capability | undefined;
  const allowed = body?.allowed;

  if (!role || !EDITABLE_ROLES.includes(role)) {
    return jsonError("Invalid or non-editable role.", 422);
  }
  if (!capability || !(CAPABILITY_KEYS as string[]).includes(capability)) {
    return jsonError("Invalid capability.", 422);
  }
  if (typeof allowed !== "boolean") {
    return jsonError("`allowed` must be a boolean.", 422);
  }

  await db
    .insert(rolePermissions)
    .values({ role, capability, allowed })
    .onConflictDoUpdate({
      target: [rolePermissions.role, rolePermissions.capability],
      set: { allowed, updatedAt: new Date() },
    });

  return jsonData({ role, capability, allowed });
}
