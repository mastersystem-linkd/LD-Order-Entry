// Edge-safe Auth.js config. Contains NO database or bcrypt imports, so it can be
// used to build the NextAuth instance that powers the (Edge) middleware.
// The Credentials provider (which needs the DB + bcrypt) lives in lib/auth.ts.
import type { NextAuthConfig } from "next-auth";
import { DEFAULT_ROLE_CAPS, type Capability, type Role } from "@/lib/rbac";

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [], // Credentials provider is added in lib/auth.ts (Node runtime).
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on initial sign-in; persist id + role on the token.
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const role = (token.role as Role | undefined) ?? "VIEWER";
        session.user.id = (token.id as string | undefined) ?? "";
        session.user.role = role;
        // Fallback to code defaults for tokens issued before caps existed, so a
        // deploy never locks out already-signed-in users (refreshed on login).
        session.user.caps =
          (token.caps as Capability[] | undefined) ?? DEFAULT_ROLE_CAPS[role];
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
