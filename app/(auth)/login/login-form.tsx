"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

// Auth.js sends users back to /login?error=<code> on OAuth failures.
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "This Google account isn't authorized. Ask an admin to add your email.",
  Configuration: "Google sign-in isn't configured yet.",
  OAuthAccountNotLinked: "That email is already registered with a password.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function LoginForm({
  callbackUrl,
  googleEnabled = false,
  initialError,
}: {
  callbackUrl: string;
  googleEnabled?: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError
      ? (ERROR_MESSAGES[initialError] ?? "Couldn't sign in. Please try again.")
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Invalid email or password.");
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function onGoogle() {
    setError(null);
    setGoogleLoading(true);
    // Full-page OAuth redirect; Auth.js returns to `callbackUrl` (or /login on error).
    signIn("google", { callbackUrl });
  }

  return (
    <div className="flex flex-col">
      {googleEnabled ? (
        <>
          <button
            type="button"
            onClick={onGoogle}
            disabled={googleLoading || loading}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line-strong bg-surface px-4 py-3 text-[14.5px] font-semibold text-ink transition-colors hover:border-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
          >
            {googleLoading ? <Spinner /> : <GoogleIcon />} Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-[10px] bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col">
        <div className="mb-4">
          <Label htmlFor="email" className="mb-2 block">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-11 rounded-xl"
          />
        </div>

        <div className="mb-1.5">
          <Label htmlFor="password" className="mb-2 block">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-11 rounded-xl pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-2 grid -translate-y-1/2 place-items-center rounded-md p-1.5 text-ink-muted transition-colors hover:text-ink-soft"
            >
              {showPw ? (
                <EyeOffIcon className="size-[18px]" />
              ) : (
                <EyeIcon className="size-[18px]" />
              )}
            </button>
          </div>
        </div>

        <div className="mb-5 flex min-h-[20px] items-center justify-between gap-2">
          <span
            className={cn(
              "text-[11.5px] text-ink-muted transition-opacity",
              showHint ? "opacity-100" : "opacity-0",
            )}
          >
            Ask an admin to reset it.
          </span>
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            className="shrink-0 text-[12.5px] font-semibold text-accent hover:underline"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? (
            <>
              <Spinner className="text-white" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>
    </div>
  );
}
