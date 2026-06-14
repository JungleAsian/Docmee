"use client";

import type { AppointmentStatus } from "@docmee/contracts";
import { Badge, type BadgeProps } from "@docmee/ui";
import { useTranslations } from "next-intl";

const VARIANT: Record<AppointmentStatus, BadgeProps["variant"]> = {
  booked: "secondary",
  confirmed: "default",
  completed: "success",
  cancelled: "destructive",
  no_show: "warning",
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const t = useTranslations("appointments.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
