import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const session = await auth();
  const role = (session?.user?.role as Role) ?? "VIEWER";
  // Defense in depth — middleware already gates, but never render for non-admins.
  if (role !== "ADMIN") redirect("/");
  return <SettingsView />;
}
