"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { apiGet, apiSend } from "@/lib/api-client";
import { ROLES, type Role } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
};
type UsersResponse = { users: UserRow[]; current_user_id: string };

const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Full access incl. settings & users",
  SALES: "Create & edit orders",
  OPS: "Update operations tracking",
  VIEWER: "Read-only",
};

const selectCls =
  "h-9 rounded-field border border-line-strong bg-surface-2 px-2 text-sm font-medium text-ink outline-none transition-[border-color,box-shadow] focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50";

export function UsersAccess() {
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<Role>("VIEWER");
  const [password, setPassword] = React.useState("");

  const [resetId, setResetId] = React.useState<string | null>(null);
  const [resetPw, setResetPw] = React.useState("");
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");

  const list = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<UsersResponse>("/api/users"),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () =>
      apiSend("/api/users", "POST", {
        email: email.trim(),
        name: name.trim() || null,
        role,
        password,
      }),
    onSuccess: () => {
      setEmail("");
      setName("");
      setRole("VIEWER");
      setPassword("");
      invalidate();
      toast.success("User created.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      apiSend(`/api/users/${vars.id}`, "PATCH", vars.body),
    onSuccess: (_res, vars) => {
      if ("password" in vars.body) {
        setResetId(null);
        setResetPw("");
        toast.success("Password reset.");
      }
      if ("name" in vars.body || "email" in vars.body) {
        setEditId(null);
        toast.success("User updated.");
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiSend(`/api/users/${id}`, "DELETE"),
    onSuccess: () => {
      setConfirmId(null);
      invalidate();
      toast.success("User deleted.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const users = list.data?.users ?? [];
  const selfId = list.data?.current_user_id;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {/* Users table */}
      <Card>
        <CardHeader>
          <CardTitle>Users &amp; access</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            {list.isLoading ? (
              <div className="flex items-center gap-2 px-6 py-8 text-sm text-ink-muted">
                <Spinner /> Loading…
              </div>
            ) : (
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === selfId;
                    return (
                      <tr
                        key={u.id}
                        className="border-b border-line align-middle last:border-0"
                      >
                        <td className="px-4 py-3">
                          {editId === u.id ? (
                            <div className="flex max-w-xs flex-col gap-1.5">
                              <Input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Full name"
                                className="h-9"
                              />
                              <Input
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                placeholder="Email"
                                className="h-9"
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 font-medium">
                                {u.name || u.email.split("@")[0]}
                                {isSelf ? (
                                  <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
                                    you
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-ink-muted">
                                {u.email}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className={selectCls}
                            value={u.role}
                            disabled={isSelf || patch.isPending}
                            title={isSelf ? "You can't change your own role" : undefined}
                            onChange={(e) =>
                              patch.mutate({
                                id: u.id,
                                body: { role: e.target.value },
                              })
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            disabled={isSelf || patch.isPending}
                            onClick={() =>
                              patch.mutate({
                                id: u.id,
                                body: { is_active: !u.is_active },
                              })
                            }
                            className={cn(
                              "rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60",
                              u.is_active
                                ? "border-success/30 bg-success/15 text-success"
                                : "border-line-strong bg-inset text-ink-muted",
                            )}
                            title={
                              isSelf
                                ? "You can't deactivate yourself"
                                : u.is_active
                                  ? "Click to deactivate"
                                  : "Click to activate"
                            }
                          >
                            {u.is_active ? "Active" : "Inactive"}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {editId === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={
                                  patch.isPending ||
                                  !editEmail.includes("@") ||
                                  !editEmail.trim()
                                }
                                onClick={() =>
                                  patch.mutate({
                                    id: u.id,
                                    body: {
                                      name: editName.trim() || null,
                                      email: editEmail.trim(),
                                    },
                                  })
                                }
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditId(null)}
                              >
                                <XIcon />
                              </Button>
                            </div>
                          ) : resetId === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                type="password"
                                value={resetPw}
                                onChange={(e) => setResetPw(e.target.value)}
                                placeholder="New password"
                                className="h-9 w-40"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                disabled={patch.isPending || resetPw.length < 8}
                                onClick={() =>
                                  patch.mutate({
                                    id: u.id,
                                    body: { password: resetPw },
                                  })
                                }
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setResetId(null);
                                  setResetPw("");
                                }}
                              >
                                <XIcon />
                              </Button>
                            </div>
                          ) : confirmId === u.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-danger">Delete user?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={del.isPending}
                                onClick={() => del.mutate(u.id)}
                              >
                                Delete
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Edit user"
                                title="Edit name & email"
                                onClick={() => {
                                  setEditId(u.id);
                                  setEditName(u.name ?? "");
                                  setEditEmail(u.email);
                                }}
                              >
                                <PencilIcon />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Reset password"
                                title="Reset password"
                                onClick={() => {
                                  setResetId(u.id);
                                  setResetPw("");
                                }}
                              >
                                <KeyRoundIcon />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Delete user"
                                title={
                                  isSelf
                                    ? "You can't delete yourself"
                                    : "Delete user"
                                }
                                disabled={isSelf}
                                className="text-danger hover:bg-danger/10 hover:text-danger"
                                onClick={() => setConfirmId(u.id)}
                              >
                                <Trash2Icon />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add user */}
      <Card>
        <CardHeader>
          <CardTitle>Add user</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim() || password.length < 8) return;
              create.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-email" className="text-[13px] text-ink-soft">
                Email <span className="text-danger">*</span>
              </Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@company.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-name" className="text-[13px] text-ink-soft">
                Name
              </Label>
              <Input
                id="u-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-role" className="text-[13px] text-ink-soft">
                Role
              </Label>
              <select
                id="u-role"
                className={cn(selectCls, "h-[46px]")}
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r} — {ROLE_HINT[r]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-muted">{ROLE_HINT[role]}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-pw" className="text-[13px] text-ink-soft">
                Temporary password <span className="text-danger">*</span>
              </Label>
              <Input
                id="u-pw"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <p className="text-xs text-ink-muted">
                Share it with the user; they can change it later.
              </p>
            </div>
            <Button
              type="submit"
              disabled={
                create.isPending || !email.trim() || password.length < 8
              }
            >
              {create.isPending ? (
                <>
                  <Spinner className="text-white" /> Creating…
                </>
              ) : (
                "Create user"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
