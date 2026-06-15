"use client";

import type { Role } from "@docmee/contracts";
import { ROLES } from "@docmee/contracts";
import { Button, Card, CardContent, Input, Label, Skeleton } from "@docmee/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreateUser, useSetUserRole, useUsers } from "../../../../lib/api/admin";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

export default function TeamPage() {
  const t = useTranslations("team");
  const { data: users, isLoading } = useUsers();
  const setRole = useSetUserRole();
  const [inviting, setInviting] = useState(false);

  return (
    <SettingsSubPage title={t("title")}>
      {!inviting ? (
        <Button size="sm" onClick={() => setInviting(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("invite")}
        </Button>
      ) : (
        <InviteForm onClose={() => setInviting(false)} />
      )}

      {isLoading || !users ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <span className="font-medium">{u.name}</span>
                  <select
                    value={u.role}
                    onChange={(e) =>
                      setRole.mutate({ userId: u.id!, role: e.target.value as Role })
                    }
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label={t("role")}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </select>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("team");
  const create = useCreateUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("secretary");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), email: email.trim(), role },
      { onSuccess: onClose },
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">{t("name")}</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">{t("email")}</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">{t("role")}</Label>
            <select
              id="u-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
              {t("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
