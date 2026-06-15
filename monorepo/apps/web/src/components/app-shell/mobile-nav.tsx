"use client";

import { Button, cn } from "@docmee/ui";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { NAV_ITEMS } from "./nav-items";

export function MobileNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("common.menu")}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="close"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <nav className="absolute left-0 top-0 h-full w-64 bg-card p-3 shadow-xl" aria-label={t("app.tagline")}>
            <div className="flex h-11 items-center justify-between px-2">
              <span className="text-lg font-semibold text-primary">{t("app.name")}</span>
              <Button variant="ghost" size="icon" aria-label="close" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={key}
                    href={href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium",
                      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {t(`nav.${key}`)}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
