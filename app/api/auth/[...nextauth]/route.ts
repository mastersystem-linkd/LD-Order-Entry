// NextAuth endpoints: /api/auth/* (signin, callback, csrf, session, signout).
// Exempt from the middleware matcher so login can happen before there's a session.
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
