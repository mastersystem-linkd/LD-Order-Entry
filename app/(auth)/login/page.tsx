import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { LoginThemeToggle } from "./login-theme-toggle";

// The seven stages, named on the brand panel — the product's whole shape in one
// glance, and something only this app could put there.
const STAGES = [
  "Order entry",
  "Stock checking",
  "Rolling & checking",
  "Challan",
  "Bill",
  "Dispatch",
  "Received LR",
];

function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const onDark = tone === "dark";
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative grid size-11 shrink-0 place-items-center rounded-[13px] font-display text-[16px] font-semibold text-white"
        style={{
          background:
            "linear-gradient(145deg, var(--a3) 0%, var(--a1) 55%, var(--a2) 100%)",
          boxShadow:
            "0 8px 20px -6px var(--glow), inset 0 1px 0 rgba(255,255,255,.28)",
        }}
      >
        LD
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[13px] ring-1 ring-white/15 ring-inset"
        />
      </div>
      <div className="leading-tight">
        <b
          className={
            onDark
              ? "block font-display text-[16.5px] font-semibold tracking-[-0.02em] text-white"
              : "block font-display text-[16.5px] font-semibold tracking-[-0.02em] text-ink"
          }
        >
          Order Entry System
        </b>
        <small
          className={
            onDark
              ? "text-[11px] font-medium tracking-[0.06em] text-white/40 uppercase"
              : "text-[11px] font-medium tracking-[0.06em] text-ink-muted uppercase"
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
    <div className="relative z-[1] grid min-h-svh lg:grid-cols-[52%_48%] xl:grid-cols-[55%_45%]">
      {/* ── Brand panel ───────────────────────────────────────────────────
          Deliberately dark in BOTH themes: it is the near-black the app shell
          already uses, so signing in previews the product rather than showing a
          second, unrelated aesthetic. */}
      <section className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(165deg, #14121b 0%, #0d0c11 45%, #08080b 100%)",
          }}
        />
        {/* Two large, very soft light sources. Big and faint reads as depth;
            small and bright reads as a stock gradient. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[22%] -right-[18%] size-[46rem] rounded-full opacity-20"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, var(--a3), transparent 62%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[30%] -left-[22%] size-[42rem] rounded-full opacity-[0.14]"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, #7c5cff, transparent 65%)",
          }}
        />
        {/* Woven texture — warp and weft at 45°, in pure CSS. At ~3% it should
            only resolve on a second look; a visible pattern would cheapen it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(255,255,255,.032) 0 1px, transparent 1px 7px), repeating-linear-gradient(-45deg, rgba(255,255,255,.022) 0 1px, transparent 1px 7px)",
          }}
        />
        {/* A hairline of light along the top, and the seam against the form. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/[0.07]"
        />

        <div className="relative">
          <Wordmark />
        </div>

        <div className="relative max-w-[540px]">
          <p className="mb-6 inline-flex items-center gap-2 rounded-pill bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-white/55 uppercase ring-1 ring-white/10 ring-inset">
            <span className="size-1.5 rounded-full bg-[var(--a4)] shadow-[0_0_10px_var(--a4)]" />
            Operations tracking
          </p>

          <h1 className="font-display text-[46px] leading-[1.08] font-medium tracking-[-0.035em] xl:text-[54px]">
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(115deg, #ffffff 12%, #cfc9ff 52%, #8f86d6 100%)",
              }}
            >
              Every order,
              <br />
              always current.
            </span>
          </h1>

          <p className="mt-6 max-w-[400px] text-[15.5px] leading-[1.7] text-white/45">
            From punch to dispatch, every design tracked through all seven
            stages — in one place.
          </p>

          {/* The seven stages as a rail: product substance doing the work a
              stock illustration usually does badly. */}
          <ol className="mt-11 flex flex-wrap items-center gap-x-1.5 gap-y-2.5">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-2 rounded-pill bg-white/[0.045] py-1.5 pr-3.5 pl-2 text-[12.5px] font-medium text-white/70 ring-1 ring-white/[0.07] ring-inset">
                  <span className="num grid size-[19px] place-items-center rounded-full bg-white/[0.07] text-[10px] font-semibold text-white/50">
                    {i + 1}
                  </span>
                  {s}
                </span>
                {i < STAGES.length - 1 ? (
                  <span aria-hidden className="h-px w-2.5 bg-white/15" />
                ) : null}
              </li>
            ))}
          </ol>
        </div>

        <div className="relative flex items-center justify-between border-t border-white/[0.08] pt-6 font-mono text-[11px] tracking-wide text-white/35">
          <span>7-stage TAT · ELDEE GROUP</span>
          <span>v{version}</span>
        </div>
      </section>

      {/* ── Form panel ────────────────────────────────────────────────────
          No card, no border, no shadow: at 380px the whitespace already frames
          the form, and a box around it is what made this read as a template. */}
      <section className="relative flex items-center justify-center bg-surface px-6 py-14 sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-55"
          style={{
            background:
              "radial-gradient(60% 45% at 50% 30%, var(--accent-soft), transparent 70%)",
          }}
        />

        <div className="absolute top-6 right-6 z-[1] sm:top-8 sm:right-8">
          <LoginThemeToggle />
        </div>

        <div className="relative w-full max-w-[380px]">
          {/* Compact brand for < lg, where the dark panel is not rendered. */}
          <div className="mb-10 lg:hidden">
            <Wordmark tone="light" />
          </div>

          <div className="mb-8">
            <h2 className="font-display text-[30px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
              Sign in
            </h2>
            <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-soft">
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

          <div className="mt-9 flex items-center justify-center gap-2 text-[11px] tracking-[0.05em] text-ink-muted uppercase">
            <span className="h-px w-6 bg-line" />
            Protected access
            <span className="h-px w-6 bg-line" />
          </div>
        </div>
      </section>
    </div>
  );
}
