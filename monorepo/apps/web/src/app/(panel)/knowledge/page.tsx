"use client";

import type { KbEntry } from "@docmee/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from "@docmee/ui";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreateKbEntry, useKbEntries } from "../../../lib/api/kb";

export default function KnowledgePage() {
  const t = useTranslations("kb");
  const tc = useTranslations("common");
  const { data: entries, isLoading, isError, refetch } = useKbEntries();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("new")}
          </Button>
        ) : null}
      </div>

      {creating ? <KbCreateForm onClose={() => setCreating(false)} /> : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-destructive">{tc("error")}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc("retry")}
          </Button>
        </div>
      ) : !entries || entries.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <KbEntryCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KbEntryCard({ entry }: { entry: KbEntry }) {
  const t = useTranslations("kb");
  const locale = useLocale();
  const typeLabel = entry.type === "rule" ? t("typeRule") : t("typeManual");
  const date = entry.updatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(entry.updatedAt))
    : "";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">{entry.title || "—"}</CardTitle>
        <Badge variant={entry.type === "rule" ? "warning" : "secondary"}>{typeLabel}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="whitespace-pre-wrap text-sm text-foreground/90">{entry.content}</p>
        {date ? <p className="text-xs text-muted-foreground">{t("updated", { date })}</p> : null}
      </CardContent>
    </Card>
  );
}

function KbCreateForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("kb");
  const create = useCreateKbEntry();
  const [type, setType] = useState<"manual" | "rule">("manual");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!content.trim()) return;
    create.mutate(
      { type, title: title.trim(), content: content.trim() },
      {
        onSuccess: () => {
          setTitle("");
          setContent("");
          onClose();
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("type")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={type === "manual" ? "default" : "outline"}
                size="sm"
                onClick={() => setType("manual")}
              >
                {t("typeManual")}
              </Button>
              <Button
                type="button"
                variant={type === "rule" ? "default" : "outline"}
                size="sm"
                onClick={() => setType("rule")}
              >
                {t("typeRule")}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-title">{t("titleLabel")}</Label>
            <Input
              id="kb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-content">{t("contentLabel")}</Label>
            <Textarea
              id="kb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("contentPlaceholder")}
              rows={4}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("editPending")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || !content.trim()}>
              {create.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
