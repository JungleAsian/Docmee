import type { Route } from "next";
import { BarChart3, BookOpen, Calendar, Inbox, LayoutDashboard, Settings, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  /** i18n key under `nav.*` */
  key: string;
  href: Route;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", href: "/", icon: LayoutDashboard },
  { key: "inbox", href: "/inbox", icon: Inbox },
  { key: "patients", href: "/patients", icon: Users },
  { key: "appointments", href: "/appointments", icon: Calendar },
  { key: "knowledge", href: "/knowledge", icon: BookOpen },
  { key: "analytics", href: "/analytics", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
];
