// Full Auth.js v5 instance (Node runtime): Credentials provider validates
// email+password against the `users` table with bcrypt; JWT carries the role.
// Used by the NextAuth route handler, server components, and server actions.
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/lib/auth.config";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/email";
import { users } from "@/db/schema";

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
  ],
});
