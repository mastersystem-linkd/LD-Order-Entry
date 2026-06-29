import { count } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { customerOrders, users, workflowStages } from "@/db/schema";

// Always run fresh — this is a liveness/readiness probe, never cache it.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [[u], [o], [s]] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(customerOrders),
      db.select({ value: count() }).from(workflowStages),
    ]);

    return NextResponse.json({
      ok: true,
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      counts: {
        users: u.value,
        orders: o.value,
        stages: s.value,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
        error: error instanceof Error ? error.message : "health check failed",
      },
      { status: 500 },
    );
  }
}
