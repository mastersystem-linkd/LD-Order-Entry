import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/rbac";

// Augment Auth.js types so `session.user.role`, `user.role`, and the JWT carry
// our role. Keeps the whole app strongly typed around RBAC.
declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
  }
}
