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
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // Already signed in → straight to the app.
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl } = await searchParams;
  // Only allow internal, single-slash paths — never an external/`//` redirect.
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";

  return (
    <div className="flex min-h-svh items-center justify-center bg-bg-light p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#4F46E5,#6366F1)] text-lg font-semibold text-white">
            LD
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Order Entry System
          </h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Enter your email and password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm callbackUrl={safeCallback} />
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Operations tracking · 7-stage TAT
        </p>
      </div>
    </div>
  );
}
