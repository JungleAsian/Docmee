"use client";

import type { Locale } from "@docmee/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@docmee/ui";
import { LogOut } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useSession } from "../../lib/api/session";
import { clearToken } from "../../lib/auth";
import { setLocaleCookie } from "../../lib/locale";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserMenu() {
  const t = useTranslations();
  const activeLocale = useLocale() as Locale;
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  function changeLocale(locale: Locale) {
    if (locale === activeLocale) return;
    setLocaleCookie(locale);
    router.refresh();
  }

  function signOut() {
    clearToken();
    router.replace("/login");
    router.refresh();
  }

  if (isLoading) return <Skeleton className="h-9 w-9 rounded-full" />;
  if (!session?.user) return null;

  const name = session.user.name ?? "—";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-primary/10 text-sm font-semibold text-primary"
          aria-label={t("shell.account")}
        >
          {initials(name)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <div className="font-medium text-foreground">{name}</div>
          <div className="text-xs capitalize text-muted-foreground">{session.user.role}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("settings.language")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={activeLocale === "es"}
          onCheckedChange={() => changeLocale("es")}
        >
          {t("settings.spanish")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={activeLocale === "en"}
          onCheckedChange={() => changeLocale("en")}
        >
          {t("settings.english")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="h-4 w-4" aria-hidden />
          {t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
