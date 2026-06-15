"use client";

import { Badge } from "@docmee/ui";
import { useTranslations } from "next-intl";

/** Stub for sections delivered in later phases. Keeps nav navigable in Phase 0. */
export function PagePlaceholder({ titleKey }: { titleKey: string }) {
  const t = useTranslations();
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{t(titleKey)}</h1>
        <Badge variant="outline">{t("placeholder.comingSoon")}</Badge>
      </div>
      <p className="text-muted-foreground">{t("placeholder.comingSoonDesc")}</p>
    </div>
  );
}
