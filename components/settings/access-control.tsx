"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import {
  CAPABILITIES,
  EDITABLE_ROLES,
  type Capability,
  type Role,
} from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Th, THead } from "@/components/ui/table";

type Grants = Record<string, Record<string, boolean>>;
type AccessResponse = { grants: Grants };

// Access tab: the admin-editable Role × Capability matrix. Toggling a box grants
// or removes that capability for the role. ADMIN is always full (locked).
export function AccessControl() {
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["access"],
    queryFn: () => apiGet<AccessResponse>("/api/access"),
  });

  const toggle = useMutation({
    mutationFn: (v: { role: Role; capability: Capability; allowed: boolean }) =>
      apiSend("/api/access", "PUT", v),
    onMutate: async (v) => {
      await queryClient.cancelQueries({ queryKey: ["access"] });
      const prev = queryClient.getQueryData<AccessResponse>(["access"]);
      if (prev) {
        queryClient.setQueryData<AccessResponse>(["access"], {
          grants: {
            ...prev.grants,
            [v.role]: { ...prev.grants[v.role], [v.capability]: v.allowed },
          },
        });
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["access"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["access"] }),
  });

  const grants = q.data?.grants;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Access — what each role can do</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {q.isLoading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-sm text-ink-muted">
              <Spinner /> Loading…
            </div>
          ) : q.isError ? (
            <div className="px-6 py-8 text-sm text-danger">
              {(q.error as Error)?.message ?? "Failed to load access."}
            </div>
          ) : (
            <>
              {/* Desktop: full Role × Capability matrix */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <THead>
                    <tr>
                      <Th>Role</Th>
                      {CAPABILITIES.map((c) => (
                        <Th key={c.key} className="text-center" title={c.hint}>
                          {c.label}
                        </Th>
                      ))}
                    </tr>
                  </THead>
                  <tbody>
                    {/* ADMIN — always full, not editable */}
                    <tr className="border-b border-line">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">ADMIN</div>
                        <div className="text-xs text-ink-muted">
                          Always full access
                        </div>
                      </td>
                      {CAPABILITIES.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked
                            readOnly
                            disabled
                            aria-label={`ADMIN — ${c.label} (always on)`}
                            className="size-5 accent-[var(--accent)] opacity-60"
                          />
                        </td>
                      ))}
                    </tr>
                    {EDITABLE_ROLES.map((role) => (
                      <tr
                        key={role}
                        className="border-b border-line align-middle last:border-0"
                      >
                        <td className="px-3 py-2.5 font-medium text-ink">
                          {role}
                        </td>
                        {CAPABILITIES.map((c) => {
                          const checked = grants?.[role]?.[c.key] ?? false;
                          return (
                            <td key={c.key} className="px-1 py-1 text-center">
                              <label className="inline-flex cursor-pointer items-center justify-center p-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={toggle.isPending}
                                  onChange={(e) =>
                                    toggle.mutate({
                                      role,
                                      capability: c.key,
                                      allowed: e.target.checked,
                                    })
                                  }
                                  aria-label={`${role} — ${c.label}`}
                                  className="size-5 accent-[var(--accent)] disabled:opacity-60"
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: one section per role; capabilities as aligned rows */}
              <div className="flex flex-col divide-y divide-line border-t border-line md:hidden">
                <div className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">ADMIN</span>
                    <span className="text-xs text-ink-muted">
                      Always full access
                    </span>
                  </div>
                  <ul className="mt-1.5 flex flex-col">
                    {CAPABILITIES.map((c) => (
                      <li
                        key={c.key}
                        className="flex items-center justify-between gap-3 py-1.5"
                      >
                        <span className="text-sm text-ink-soft">{c.label}</span>
                        <input
                          type="checkbox"
                          checked
                          readOnly
                          disabled
                          aria-label={`ADMIN — ${c.label} (always on)`}
                          className="size-5 shrink-0 accent-[var(--accent)] opacity-60"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
                {EDITABLE_ROLES.map((role) => (
                  <div key={role} className="px-4 py-3">
                    <span className="font-medium text-ink">{role}</span>
                    <ul className="mt-1.5 flex flex-col">
                      {CAPABILITIES.map((c) => {
                        const checked = grants?.[role]?.[c.key] ?? false;
                        return (
                          <li key={c.key}>
                            <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
                              <span className="text-sm text-ink-soft">
                                {c.label}
                              </span>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={toggle.isPending}
                                onChange={(e) =>
                                  toggle.mutate({
                                    role,
                                    capability: c.key,
                                    allowed: e.target.checked,
                                  })
                                }
                                aria-label={`${role} — ${c.label}`}
                                className="size-5 shrink-0 accent-[var(--accent)] disabled:opacity-60"
                              />
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
            Changes take effect on the user&apos;s next sign-in. Settings &amp;
            user management stay ADMIN-only and can&apos;t be granted here.
          </p>
        </CardContent>
      </Card>

      {/* Capability reference */}
      <Card>
        <CardHeader>
          <CardTitle>What the capabilities mean</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c.key} className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{c.label}</span>
                <span className="text-xs text-ink-muted">{c.hint}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
