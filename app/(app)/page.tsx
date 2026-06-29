import Link from "next/link";

import { auth } from "@/lib/auth";
import { visibleNav } from "@/lib/rbac";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DESCRIPTIONS: Record<string, string> = {
  "/orders/new": "Create a customer order with fabric line items.",
  "/orders": "Browse, search, and open existing orders.",
  "/tracking": "Update the 7-stage operations workflow per line.",
};

export default async function HomePage() {
  const session = await auth();
  const role = session!.user.role;
  const name = session!.user.name ?? session!.user.email ?? "there";
  const items = visibleNav(role);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-[30px] font-medium tracking-[-0.02em] text-ink">
          Welcome, {name}
        </h2>
        <p className="text-sm text-ink-soft">
          You&apos;re signed in as {role}. Pick where to go next.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="block">
            <Card className="h-full transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-lg motion-reduce:hover:translate-y-0">
              <CardHeader>
                <CardTitle className="text-base">{item.label}</CardTitle>
                <CardDescription>{DESCRIPTIONS[item.href]}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
