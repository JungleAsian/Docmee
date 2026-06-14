"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function SettingsSubPage({ title, children }: { title: string; children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </Link>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
