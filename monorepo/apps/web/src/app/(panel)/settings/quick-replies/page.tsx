"use client";

import { Badge, Button, Card, CardContent, Input, Label, Skeleton, Textarea } from "@docmee/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreateQuickReply, useQuickReplies } from "../../../../lib/api/admin";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

export default function QuickRepliesPage() {
  const t = useTranslations("quickReplies");
  const { data: replies, isLoading } = useQuickReplies();
  const create = useCreateQuickReply();
  const [open, setOpen] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shortcut.trim() || !body.trim()) return;
    create.mutate(
      { shortcut: shortcut.trim(), body: body.trim() },
      {
        onSuccess: () => {
          setShortcut("");
          setBody("");
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
                <Label htmlFor="qr-shortcut">{t("shortcut")}</Label>
                <Input id="qr-shortcut" value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/atajo" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qr-body">{t("body")}</Label>
                <Textarea id="qr-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
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

      {isLoading || !replies ? (
        <Skeleton className="h-24 w-full" />
      ) : replies.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {replies.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="space-y-1 py-3">
                  <Badge variant="outline">{r.shortcut}</Badge>
                  <p className="text-sm text-foreground/90">{r.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}
