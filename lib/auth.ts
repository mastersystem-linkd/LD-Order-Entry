// Full Auth.js v5 instance (Node runtime): Credentials provider validates
// email+password against the `users` table with bcrypt; JWT carries the role.
// Used by the NextAuth route handler, server components, and server actions.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";

import { authConfig } from "@/lib/auth.config";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import {
  CAPABILITY_KEYS,
  DEFAULT_ROLE_CAPS,
  type Capability,
  type Role,
} from "@/lib/rbac";
import { rolePermissions, users } from "@/db/schema";

// Resolve a role's granted capabilities from the admin-editable matrix. ADMIN is
// always full; a role with no stored rows falls back to the code defaults.
async function capsForRole(role: Role): Promise<Capability[]> {
  if (role === "ADMIN") return [...CAPABILITY_KEYS];
  try {
    const rows = await db
      .select({
        capability: rolePermissions.capability,
        allowed: rolePermissions.allowed,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role));
    if (rows.length === 0) return [...DEFAULT_ROLE_CAPS[role]];
    return rows
      .filter((r) => r.allowed)
      .map((r) => r.capability)
      .filter((c): c is Capability =>
        (CAPABILITY_KEYS as string[]).includes(c),
      );
  } catch {
    // role_permissions not present yet (e.g. code deployed before migration
    // 0004) — fall back to code defaults so logins never 500.
    return [...DEFAULT_ROLE_CAPS[role]];
  }
}

// Google is only wired up when its OAuth credentials are present, so the app
// runs fine before they're configured (the login page hides the button).
const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A valid bcrypt hash of a throwaway string. Compared against when no matching
// user exists so every login attempt spends one bcrypt round — removes the
// timing oracle that would otherwise reveal which emails are real accounts.
const DUMMY_PASSWORD_HASH =
  "$2b$10$e4ei7jKCCV9.g9.7D0nW/emMtKFkrv8gfNCraq5yd8B0JemEXTH/e";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = normalizeEmail(parsed.data.email);

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        // Always run one comparison (real hash or dummy) for constant-ish timing.
        const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(parsed.data.password, hash);

        if (!user || !user.isActive || !user.passwordHash || !valid) return null;

        // Returned object becomes `user` in the jwt callback.
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          role: user.role,
        };
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Google sign-in is allowed ONLY for an email that already exists as an
    // ACTIVE user. The app is role-gated, so we never auto-provision access —
    // an admin must add the person (Settings → Users & access) first.
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true; // credentials pre-validated
      const email = normalizeEmail(user.email ?? "");
      if (!email) return false;
      const [dbUser] = await db
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return Boolean(dbUser?.isActive);
    },
    // Persist the app user's id + role + resolved capabilities on the JWT (the
    // edge middleware and the APIs read these). Capabilities are resolved once
    // at sign-in, so Access-matrix changes take effect on the user's next login.
    async jwt({ token, user, account }) {
      let role: Role | undefined;
      if (account?.provider === "google" && user?.email) {
        const email = normalizeEmail(user.email);
        const [dbUser] = await db
          .select({ id: users.id, role: users.role, name: users.name })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          role = dbUser.role;
          if (dbUser.name) token.name = dbUser.name;
        }
      } else if (user) {
        token.id = user.id;
        role = (user as { role?: Role }).role;
        token.role = role;
      }
      if (role) token.caps = await capsForRole(role);
      return token;
    },
  },
});
