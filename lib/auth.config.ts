// Edge-safe Auth.js config. Contains NO database or bcrypt imports, so it can be
// used to build the NextAuth instance that powers the (Edge) middleware.
// The Credentials provider (which needs the DB + bcrypt) lives in lib/auth.ts.
import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/rbac";

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
        session.user.id = (token.id as string | undefined) ?? "";
        session.user.role = token.role as Role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
