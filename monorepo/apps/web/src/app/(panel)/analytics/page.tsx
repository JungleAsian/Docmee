"use client";

import { Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from "@docmee/ui";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAnalyticsOverview, useMessageSearch } from "../../../lib/api/analytics";

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const { data, isLoading } = useAnalyticsOverview();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {isLoading || !data ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t("conversations7d")} value={String(data.conversations7d ?? 0)} />
            <Kpi label={t("bookings7d")} value={String(data.bookings7d ?? 0)} />
            <Kpi label={t("deflection")} value={`${Math.round((data.deflectionRate ?? 0) * 100)}%`} />
            <Kpi label={t("avgResponse")} value={t("seconds", { n: data.avgResponseSeconds ?? 0 })} />
          </div>
          <Card>
            <CardContent className="pt-6">
              <BarChart series={data.series ?? []} />
            </CardContent>
          </Card>
        </>
      )}

      <MessageSearch />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function BarChart({
  series,
}: {
  series: NonNullable<ReturnType<typeof useAnalyticsOverview>["data"]>["series"];
}) {
  const rows = series ?? [];
  const max = Math.max(1, ...rows.map((d) => d?.conversations ?? 0));
  return (
    <div className="flex h-40 items-end gap-2">
      {rows.map((d, i) => (
        <div key={d?.date ?? i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary"
            style={{ height: `${((d?.conversations ?? 0) / max) * 100}%` }}
            title={`${d?.date}: ${d?.conversations}`}
          />
          <span className="text-[10px] text-muted-foreground">{d?.date?.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function MessageSearch() {
  const t = useTranslations("analytics");
  const [q, setQ] = useState("");
  const { data: results, isFetching } = useMessageSearch(q);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("search")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
        {q.trim().length > 1 ? (
          isFetching ? (
            <Skeleton className="h-12 w-full" />
          ) : (results?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noResults")}</p>
          ) : (
            <ul className="space-y-2">
              {results!.map((m) => (
                <li key={m.id} className="rounded-md border border-border p-2 text-sm">
                  <span className="text-xs uppercase text-muted-foreground">{m.author}</span>
                  <p>{m.body}</p>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
