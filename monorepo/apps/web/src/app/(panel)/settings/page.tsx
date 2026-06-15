"use client";

import type { Locale } from "@docmee/contracts";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@docmee/ui";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "../../../lib/api/session";
import { setLocaleCookie } from "../../../lib/locale";
import { getActiveTheme, setTheme, type Theme } from "../../../lib/theme";

const HUB_LINKS: { key: string; href: Route }[] = [
  { key: "team", href: "/settings/team" },
  { key: "quickReplies", href: "/settings/quick-replies" },
  { key: "channels", href: "/settings/channels" },
  { key: "templates", href: "/settings/templates" },
  { key: "automation", href: "/settings/automation" },
  { key: "doctors", href: "/settings/doctors" },
  { key: "flows", href: "/settings/flows" },
  { key: "integrations", href: "/settings/integrations" },
  { key: "notifications", href: "/settings/notifications" },
];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const activeLocale = useLocale() as Locale;
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  function changeLocale(locale: Locale) {
    if (locale === activeLocale) return;
    setLocaleCookie(locale);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <SettingsHub />

      <Card>
        <CardHeader>
          <CardTitle>{t("language")}</CardTitle>
          <CardDescription>{t("languageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            variant={activeLocale === "es" ? "default" : "outline"}
            size="sm"
            onClick={() => changeLocale("es")}
          >
            {t("spanish")}
          </Button>
          <Button
            variant={activeLocale === "en" ? "default" : "outline"}
            size="sm"
            onClick={() => changeLocale("en")}
          >
            {t("english")}
          </Button>
        </CardContent>
      </Card>

      <ThemeCard />

      <Card>
        <CardHeader>
          <CardTitle>{t("clinic")}</CardTitle>
          <CardDescription>{t("clinicDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : (
            <code className="text-sm">{session?.clinicId ?? "—"}</code>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("account")}</CardTitle>
          <CardDescription>{t("accountDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading ? (
            <Skeleton className="h-5 w-48" />
          ) : (
            <div className="flex items-center justify-between">
              <span>{session?.user?.name ?? "—"}</span>
              <Badge variant="secondary">{session?.role}</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ThemeCard() {
  const t = useTranslations("settings");
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(getActiveTheme());
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("theme")}</CardTitle>
        <CardDescription>{t("themeDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button
          variant={theme === "light" ? "default" : "outline"}
          size="sm"
          onClick={() => choose("light")}
        >
          {t("themeLight")}
        </Button>
        <Button
          variant={theme === "dark" ? "default" : "outline"}
          size="sm"
          onClick={() => choose("dark")}
        >
          {t("themeDark")}
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsHub() {
  const t = useTranslations("settingsHub");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sections")}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {HUB_LINKS.map(({ key, href }) => (
          <Link
            key={key}
            href={href}
            className="flex items-center justify-between px-6 py-3 text-sm transition-colors hover:bg-muted"
          >
            <span>{t(key)}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
