"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@docmee/ui";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { subscribePush } from "../../../../lib/api/integrations";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

type State = "unsupported" | "default" | "granted" | "denied" | "enabling";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const [state, setState] = useState<State>("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setState("unsupported");
    } else {
      setState(Notification.permission as State);
    }
  }, []);

  async function enable() {
    if (!("Notification" in window)) return;
    setState("enabling");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission as State);
      return;
    }
    // Register a Web Push subscription (mock endpoint; real VAPID key wired at X-step).
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
      const endpoint = reg ? `${location.origin}/push/${Date.now()}` : `${location.origin}/push/local`;
      await subscribePush({ endpoint });
    } catch {
      // non-fatal in the mock
    }
    setState("granted");
  }

  return (
    <SettingsSubPage title={t("title")}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("pushDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {state === "unsupported" ? (
            <p className="text-sm text-muted-foreground">{t("unsupported")}</p>
          ) : state === "granted" ? (
            <p className="text-sm text-success">{t("enabled")}</p>
          ) : state === "denied" ? (
            <p className="text-sm text-destructive">{t("blocked")}</p>
          ) : (
            <Button size="sm" disabled={state === "enabling"} onClick={() => void enable()}>
              {t("enable")}
            </Button>
          )}
        </CardContent>
      </Card>
    </SettingsSubPage>
  );
}
