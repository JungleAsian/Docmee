"use client";

import { ClinicSwitcher } from "./clinic-switcher";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

export function Topbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <MobileNav />
        <ClinicSwitcher />
      </div>
      <UserMenu />
    </header>
  );
}
