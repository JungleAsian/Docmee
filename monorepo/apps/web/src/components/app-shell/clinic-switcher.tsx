"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@docmee/ui";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useClinics } from "../../lib/api/admin";
import { useSession } from "../../lib/api/session";

/**
 * Clinic context switcher. Today the session carries a single `clinicId`, so it
 * displays the active clinic. True multi-clinic switching needs a `GET /clinics`
 * contract endpoint (2A / multi-user) — wired structurally, gated until then.
 */
export function ClinicSwitcher() {
  const t = useTranslations("shell");
  const { data: session, isLoading } = useSession();
  const { data: clinics } = useClinics();

  if (isLoading) return <Skeleton className="h-9 w-44" />;
  if (!session) return null;

  const current = clinics?.find((c) => c.id === session.clinicId);
  const label = current?.name ?? session.clinicId;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[16rem] gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="truncate font-medium">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{t("switchClinic")}</DropdownMenuLabel>
        {(clinics ?? [{ id: session.clinicId, name: label, status: "active" as const }]).map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={c.id === session.clinicId}
            disabled={c.id !== session.clinicId}
          >
            {c.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("multiClinicPending")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
