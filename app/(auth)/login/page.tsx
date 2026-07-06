import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { LoginThemeToggle } from "./login-theme-toggle";

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
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";

  return (
    <div className="relative z-[1] grid min-h-svh lg:grid-cols-[44%_56%]">
      {/* Brand panel — a fixed dark canvas in both themes (darker than either
          surface, so the split keeps its contrast in light AND dark). */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#100e15] p-12 text-white lg:flex xl:p-14">
        <span
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full opacity-[0.12]"
          style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
        />

        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-[11px] bg-accent font-display text-[16px] font-semibold text-white shadow-sm">
            LD
          </div>
          <div>
            <b className="block font-display text-[17px] font-semibold tracking-[-0.02em]">
              Order Entry System
            </b>
            <small className="text-[11px] font-medium tracking-[0.03em] text-white/55">
              Fabric ERP
            </small>
          </div>
        </div>

        <div className="relative max-w-[400px]">
          <h1 className="font-display text-[40px] leading-[1.12] font-medium tracking-[-0.03em]">
            Every order, always current.
          </h1>
          <p className="mt-5 max-w-[360px] text-[15px] leading-[1.65] text-white/55">
            Capture orders and follow all seven stages — from punch to dispatch —
            in one place.
          </p>
        </div>

        <div className="relative flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[11.5px] text-white/55">
          <span>Operations tracking · 7-stage TAT</span>
          <span>v{version}</span>
        </div>
      </section>

      {/* Form panel */}
      <section className="relative flex items-center justify-center bg-surface px-6 py-12 sm:px-10">
        <div className="absolute top-6 right-6 sm:top-7 sm:right-8">
          <LoginThemeToggle />
        </div>

        <div className="w-full max-w-[380px]">
          {/* Compact brand for < lg (the dark panel is desktop-only) */}
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <div className="grid size-10 place-items-center rounded-[11px] bg-accent font-display text-[16px] font-semibold text-white shadow-sm">
              LD
            </div>
            <div>
              <b className="block font-display text-[15px] font-semibold tracking-[-0.02em] text-ink">
                Order Entry System
              </b>
              <small className="text-[11px] font-medium text-ink-muted">
                Fabric ERP
              </small>
            </div>
          </div>

          <div className="mb-7">
            <h2 className="font-display text-[27px] font-semibold tracking-[-0.025em] text-ink">
              Sign in
            </h2>
            <p className="mt-2 text-[14px] leading-[1.5] text-ink-soft">
              {googleEnabled
                ? "Use your Google account, or your email and password."
                : "Enter your email and password to continue."}
            </p>
          </div>

          <LoginForm
            callbackUrl={safeCallback}
            googleEnabled={googleEnabled}
            initialError={error}
          />

          <p className="mt-7 text-center font-mono text-[11px] text-ink-muted">
            Protected access · LD Silk Mills
          </p>
        </div>
      </section>
    </div>
  );
}
