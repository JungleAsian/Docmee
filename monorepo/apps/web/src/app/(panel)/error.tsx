"use client";

import { Button } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function PanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // Surface to the console in dev; wired to Sentry at the observability checkpoint.
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-lg font-medium text-destructive">{t("error")}</p>
      <Button variant="outline" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
