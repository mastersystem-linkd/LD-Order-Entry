"use client";

import * as React from "react";
import {
  DatabaseIcon,
  ListIcon,
  ShieldCheckIcon,
  TimerIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";

import type { Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/ui/reveal";
import { DropdownMaster } from "@/components/settings/dropdown-master";
import { DesignDatabasePanel } from "@/components/settings/design-db";
import { TimeTracking } from "@/components/settings/time-tracking";
import { UsersManage } from "@/components/settings/users-manage";
import { AccessControl } from "@/components/settings/access-control";
import { TrashView } from "@/components/trash/trash-view";

type Tab = "dropdowns" | "designs" | "sla" | "users" | "access" | "trash";

const TABS: { key: Tab; label: string; icon: typeof ListIcon }[] = [
  { key: "dropdowns", label: "Dropdown Master", icon: ListIcon },
  { key: "designs", label: "Design Database", icon: DatabaseIcon },
  { key: "sla", label: "Time tracking", icon: TimerIcon },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "access", label: "Access", icon: ShieldCheckIcon },
  { key: "trash", label: "Trash", icon: Trash2Icon },
];

export function SettingsView({ caps }: { caps: Capability[] }) {
  const [tab, setTab] = React.useState<Tab>("dropdowns");

  return (
    <div className="flex flex-col gap-5">
      <Reveal index={0}>
        <div className="flex flex-wrap gap-1.5 rounded-field border border-line bg-surface-2 p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-[8px] px-3.5 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </Reveal>

      <Reveal index={1}>
        {tab === "dropdowns" ? <DropdownMaster /> : null}
        {tab === "designs" ? <DesignDatabasePanel /> : null}
        {tab === "sla" ? <TimeTracking /> : null}
        {tab === "users" ? <UsersManage /> : null}
        {tab === "access" ? <AccessControl /> : null}
        {tab === "trash" ? <TrashView caps={caps} /> : null}
      </Reveal>
    </div>
  );
}
