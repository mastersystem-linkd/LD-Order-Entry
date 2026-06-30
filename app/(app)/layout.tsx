import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell/app-shell";
import { signOutAction } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defense in depth — middleware already gates, but never render the shell
  // without a session.
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  const user = {
    name: session.user.name ?? session.user.email ?? "User",
    role,
  };

  return (
    <AppShell role={role} user={user} signOutAction={signOutAction}>
      {children}
    </AppShell>
  );
}
