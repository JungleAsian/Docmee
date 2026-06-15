"use client";

import type { ExportJob } from "../../../../lib/api/contract-types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Skeleton,
  type BadgeProps,
} from "@docmee/ui";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";
import {
  useCreateDocument,
  useCreateExport,
  useDocuments,
  useExports,
} from "../../../../lib/api/integrations";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

const DOC_VARIANT: Record<string, BadgeProps["variant"]> = {
  uploaded: "secondary",
  processing: "warning",
  ingested: "success",
  failed: "destructive",
};
const EXP_VARIANT: Record<string, BadgeProps["variant"]> = {
  pending: "secondary",
  running: "warning",
  done: "success",
  failed: "destructive",
};
type Target = NonNullable<ExportJob["target"]>;

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  return (
    <SettingsSubPage title={t("title")}>
      <Documents />
      <Exports />
    </SettingsSubPage>
  );
}

function Documents() {
  const t = useTranslations("integrations");
  const { data: docs, isLoading } = useDocuments();
  const create = useCreateDocument();
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) create.mutate({ filename: file.name });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("documents")}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={create.isPending}>
          <Upload className="h-4 w-4" aria-hidden />
          {t("upload")}
        </Button>
        <input ref={fileRef} type="file" className="hidden" onChange={onPick} />
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading || !docs ? (
          <Skeleton className="h-16 w-full" />
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{d.filename}</span>
              <Badge variant={DOC_VARIANT[d.status ?? "uploaded"]}>
                {t(`docStatus.${d.status ?? "uploaded"}`)}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Exports() {
  const t = useTranslations("integrations");
  const { data: jobs, isLoading } = useExports();
  const create = useCreateExport();
  const [target, setTarget] = useState<Target>("sheets");
  const [consent, setConsent] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) return;
    create.mutate({ target, consent });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("exports")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exp-target">{t("target")}</Label>
            <select
              id="exp-target"
              value={target}
              onChange={(e) => setTarget(e.target.value as Target)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="sheets">{t("targets.sheets")}</option>
              <option value="crm">{t("targets.crm")}</option>
              <option value="csv">{t("targets.csv")}</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            />
            <span>{t("consent")}</span>
          </label>
          <Button type="submit" size="sm" disabled={!consent || create.isPending}>
            {t("create")}
          </Button>
        </form>

        {isLoading || !jobs ? null : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noExports")}</p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between text-sm">
                <span>{t(`targets.${j.target ?? "csv"}`)}</span>
                <Badge variant={EXP_VARIANT[j.status ?? "pending"]}>
                  {t(`exportStatus.${j.status ?? "pending"}`)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
