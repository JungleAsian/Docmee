"use client";

import { Badge, Button, Card, CardContent, Input, Label, Skeleton } from "@docmee/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreateFlow, useFlows } from "../../../../lib/api/flows";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

export default function FlowsPage() {
  const t = useTranslations("flows");
  const { data: flows, isLoading } = useFlows();
  const create = useCreateFlow();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), enabled: true },
      {
        onSuccess: () => {
          setName("");
          setOpen(false);
        },
      },
    );
  }

  return (
    <SettingsSubPage title={t("title")}>
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("new")}
        </Button>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="f-name">{t("name")}</Label>
                <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" size="sm" disabled={create.isPending}>
                  {t("save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading || !flows ? (
        <Skeleton className="h-24 w-full" />
      ) : flows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {flows.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{f.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("steps", { n: f.steps?.length ?? 0 })}
                    </p>
                  </div>
                  {f.enabled ? <Badge variant="success">{t("enabled")}</Badge> : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}
