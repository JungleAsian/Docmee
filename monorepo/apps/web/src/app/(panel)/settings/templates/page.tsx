"use client";

import type { Template } from "../../../../lib/api/contract-types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  Textarea,
  type BadgeProps,
} from "@docmee/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  useCreateTemplate,
  useSubmitTemplate,
  useTemplates,
} from "../../../../lib/api/templates";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  draft: "secondary",
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

type Category = NonNullable<Template["category"]>;

export default function TemplatesPage() {
  const t = useTranslations("templates");
  const { data: templates, isLoading } = useTemplates();
  const submit = useSubmitTemplate();
  const [open, setOpen] = useState(false);

  return (
    <SettingsSubPage title={t("title")}>
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("new")}
        </Button>
      ) : (
        <CreateForm onClose={() => setOpen(false)} />
      )}

      {isLoading || !templates ? (
        <Skeleton className="h-28 w-full" />
      ) : templates.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => (
            <li key={tpl.id}>
              <Card>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{tpl.name}</span>
                    <Badge variant={STATUS_VARIANT[tpl.status ?? "draft"]}>
                      {t(`status.${tpl.status ?? "draft"}`)}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground/90">{tpl.body}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{t(`categories.${tpl.category ?? "utility"}`)}</Badge>
                    {tpl.status === "draft" ? (
                      <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate(tpl.id!)}>
                        {t("submit")}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("templates");
  const create = useCreateTemplate();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("utility");
  const [body, setBody] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !body.trim()) return;
    create.mutate(
      { name: name.trim(), category, language: "es", body: body.trim() },
      { onSuccess: onClose },
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">{t("name")}</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-cat">{t("category")}</Label>
            <select
              id="tpl-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="utility">{t("categories.utility")}</option>
              <option value="marketing">{t("categories.marketing")}</option>
              <option value="authentication">{t("categories.authentication")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-body">{t("body")}</Label>
            <Textarea id="tpl-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
