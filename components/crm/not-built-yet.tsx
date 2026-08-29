import * as React from "react";

import { Card } from "@/components/ui/card";

// The CRM sub-nav names four sections, but only Follow-ups is built (OE-P14–16).
// These three are OE-P17/P18. An honest placeholder beats a 404 from a nav item
// the sidebar is already showing — and it says WHY the screen is empty, which
// "coming soon" does not.
export function NotBuiltYet({
  title,
  phase,
  what,
  blocked,
}: {
  title: string;
  phase: string;
  what: string;
  blocked?: string;
}) {
  return (
    <Card className="mx-auto mt-6 max-w-[560px] px-6 py-8 text-center">
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-[42ch] text-[13.5px] leading-[1.6] text-ink-soft">
        {what}
      </p>
      {blocked ? (
        <p className="mx-auto mt-3 max-w-[42ch] text-[12.5px] leading-[1.6] text-ink-muted">
          {blocked}
        </p>
      ) : null}
      <p className="mt-5 inline-flex items-center gap-2 rounded-pill bg-inset px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-ink-soft uppercase">
        {phase} · not built
      </p>
    </Card>
  );
}
