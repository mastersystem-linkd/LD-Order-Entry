import type { DefaultSession } from "next-auth";
import type { Capability, Role } from "@/lib/rbac";

// Augment Auth.js types so `session.user.role` + `.caps`, `user.role`, and the
// JWT carry our role and its resolved capabilities. Keeps the whole app
// strongly typed around RBAC. `caps` is resolved from role_permissions at login.
declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      caps: Capability[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    caps?: Capability[];
  }
}
