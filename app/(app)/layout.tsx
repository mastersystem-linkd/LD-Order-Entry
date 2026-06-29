import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Header } from "@/components/app-shell/header";
import { Footer } from "@/components/app-shell/footer";
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
    <div className="relative z-[1] flex min-h-svh">
      <Sidebar role={role} />
      <div className="flex min-h-svh min-w-0 flex-1 flex-col">
        <Header user={user} signOutAction={signOutAction} />
        <main className="mx-auto w-full max-w-[1180px] flex-1 px-[34px] py-[30px]">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
