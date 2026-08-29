import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { LoginThemeToggle } from "./login-theme-toggle";

// Three plain statements instead of a row of seven chips. The chips wrapped
// onto a second line with connector dashes dangling off the end, which is the
// sort of small mess that makes a screen look unfinished.
const POINTS = [
  "Every design tracked from punch to dispatch",
  "Delays visible the day they happen",
  "One record per order — entry, challan, bill, LR",
];

function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const onDark = tone === "dark";
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid size-10 shrink-0 place-items-center rounded-[12px] font-display text-[15px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--a3), var(--a2))",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.22)",
        }}
      >
        LD
      </div>
      <div className="leading-tight">
        <b
          className={
            onDark
              ? "block font-display text-[15.5px] font-semibold tracking-[-0.015em] text-white/90"
              : "block font-display text-[15.5px] font-semibold tracking-[-0.015em] text-ink"
          }
        >
          Order Entry System
        </b>
        <small
          className={
            onDark
              ? "text-[10.5px] font-medium tracking-[0.14em] text-white/55 uppercase"
              : "text-[10.5px] font-medium tracking-[0.14em] text-ink-muted uppercase"
          }
        >
          LD Silk Mills
        </small>
      </div>
    </div>
  );
}

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
    <div className="relative z-[1] grid min-h-svh lg:grid-cols-[46%_54%]">
      {/* ── Brand panel ───────────────────────────────────────────────────
          Restraint is the whole brief here. One smooth ground, one light
          source, no texture: the crosshatch that was here read as noise at
          any real screen size, which is the opposite of premium. */}
      <section className="relative hidden flex-col justify-between overflow-hidden px-14 py-14 text-white lg:flex xl:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #17151f 0%, #100e16 42%, #0a090d 100%)",
          }}
        />
        {/* A single, very large, very soft light low on the panel. One is
            elegant; two competing glows is a gradient demo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[38%] left-[-18%] size-[52rem] rounded-full opacity-[0.16]"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, var(--a3), transparent 62%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/[0.06]"
        />

        <div className="relative">
          <Wordmark />
        </div>

        {/* The message sits on the optical centre, not the geometric one. */}
        <div className="relative -mt-10 max-w-[460px]">
          <p className="mb-7 text-[10.5px] font-semibold tracking-[0.22em] text-white/50 uppercase">
            Operations tracking
          </p>

          <h1 className="font-display text-[42px] leading-[1.14] font-medium tracking-[-0.03em] text-white xl:text-[46px]">
            Every order,
            <br />
            always current.
          </h1>

          <p className="mt-6 max-w-[380px] text-[15px] leading-[1.7] text-white/65">
            One place to capture an order and follow every design through all
            seven stages.
          </p>

          <ul className="mt-10 space-y-3.5 border-t border-white/[0.07] pt-8">
            {POINTS.map((t) => (
              <li
                key={t}
                className="flex items-start gap-3 text-[13.5px] leading-[1.5] text-white/72"
              >
                <span
                  aria-hidden
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-white/30"
                />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center justify-between font-mono text-[10.5px] tracking-[0.08em] text-white/45">
          <span>ELDEE GROUP</span>
          <span>v{version}</span>
        </div>
      </section>

      {/* ── Form panel ────────────────────────────────────────────────────
          No card: at 380px the whitespace frames the form on its own, and a
          bordered box is what made the earlier version read as a template. */}
      <section className="relative flex items-center justify-center bg-surface px-6 py-16 sm:px-10">
        {/* One faint wash from the top so the panel is not a flat void. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[42%]"
          style={{
            background:
              "linear-gradient(180deg, var(--accent-soft), transparent 100%)",
            opacity: 0.5,
          }}
        />

        <div className="absolute top-7 right-7 z-[1] sm:top-8 sm:right-9">
          <LoginThemeToggle />
        </div>

        <div className="relative w-full max-w-[380px]">
          {/* Compact brand for < lg, where the dark panel is not rendered. */}
          <div className="mb-11 lg:hidden">
            <Wordmark tone="light" />
          </div>

          <div className="mb-8">
            <h2 className="font-display text-[28px] leading-[1.2] font-semibold tracking-[-0.025em] text-ink">
              Sign in
            </h2>
            <p className="mt-2 text-[14px] leading-[1.55] text-ink-soft">
              {googleEnabled
                ? "Continue with Google, or use your email and password."
                : "Enter your email and password to continue."}
            </p>
          </div>

          <LoginForm
            callbackUrl={safeCallback}
            googleEnabled={googleEnabled}
            initialError={error}
          />

          <p className="mt-10 text-center text-[11px] tracking-[0.06em] text-ink-muted uppercase">
            Protected access · LD Silk Mills
          </p>
        </div>
      </section>
    </div>
  );
}
