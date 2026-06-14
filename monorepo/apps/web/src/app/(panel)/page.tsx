"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { MOCKING_ENABLED } from "../../config/env";
import { useSession } from "../../lib/api/session";

export default function OverviewPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const { data: session, isLoading, isError, refetch } = useSession();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-destructive">{tc("error")}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {tc("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("welcome", { name: session.user?.name ?? "—" })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label={t("role")} value={<Badge variant="secondary">{session.role}</Badge>} />
          <Row label={t("clinic")} value={<code>{session.clinicId}</code>} />
          <Row label={t("locale")} value={<Badge variant="outline">{session.locale}</Badge>} />
          <p className="pt-2 text-muted-foreground">
            {t("sessionLive", { source: MOCKING_ENABLED ? t("mock") : t("real") })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
