"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@docmee/ui";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api/client";
import { subscribePush } from "../../../../lib/api/integrations";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

type State = "unsupported" | "default" | "granted" | "denied" | "enabling";

/** VAPID public key (base64url) → Uint8Array for pushManager.subscribe. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

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
    // Register a real Web Push subscription: fetch the VAPID key, subscribe via the
    // service worker, then send {endpoint, p256dh, auth} to the API. No-ops cleanly
    // when there's no SW/VAPID (mock/dev) — push just isn't wired there.
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
      const { publicKey } = await apiFetch<{ publicKey: string | null }>("/push/vapid-key");
      if (reg && publicKey) {
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
          }));
        const json = sub.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await subscribePush({
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          });
        }
      }
    } catch {
      // non-fatal: no SW/VAPID/push service available (mock/dev)
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
