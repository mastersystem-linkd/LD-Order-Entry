import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  // Already signed in → straight to the app.
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl, error } = await searchParams;
  // Only allow internal, single-slash paths — never an external/`//` redirect.
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";
  const googleEnabled = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );

  return (
    <div className="relative z-[1] flex min-h-svh items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <div className="grid size-11 place-items-center rounded-[12px] bg-accent font-display text-lg font-semibold text-white shadow-sm">
            LD
          </div>
          <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
            Order Entry System
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              {googleEnabled
                ? "Continue with Google, or use your email and password."
                : "Enter your email and password to continue."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm
              callbackUrl={safeCallback}
              googleEnabled={googleEnabled}
              initialError={error}
            />
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-ink-muted">
          Operations tracking · 7-stage TAT
        </p>
      </div>
    </div>
  );
}
