// Route protection (OE-P1 §2). Runs on the Edge using the DB-free auth.config,
// so it only reads/verifies the session JWT — no Credentials/bcrypt/DB here.
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth.config";
import { canAccessPath, type Role } from "@/lib/rbac";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const isApi = path.startsWith("/api");
  const session = req.auth;

  // Unauthenticated: APIs get 401 JSON; pages redirect to /login with a callback.
  if (!session?.user) {
    if (isApi) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", path + nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated but role not permitted for this path.
  const role = session.user.role as Role;
  if (!canAccessPath(role, path)) {
    if (isApi) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Bounce to a page every role can see.
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // Protect everything EXCEPT: NextAuth endpoints, the API-key export route,
  // the public health probe, the login page, Next internals, and static files.
  matcher: [
    "/((?!api/auth|api/export|api/health|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
