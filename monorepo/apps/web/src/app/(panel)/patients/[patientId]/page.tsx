"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Skeleton,
} from "@docmee/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAppointments } from "../../../../lib/api/appointments";
import { useConversations } from "../../../../lib/api/conversations";
import { usePatient } from "../../../../lib/api/patients";
import { AppointmentStatusBadge } from "../../../../components/appointments/status-badge";
import { ChannelBadge, ModeBadge } from "../../../../components/inbox/badges";

export default function PatientDetailPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = params.patientId;
  const t = useTranslations("patients");
  const locale = useLocale();
  const { data: patient, isLoading } = usePatient(patientId);
  const { data: appointments } = useAppointments({ patientId });
  const { data: conversations } = useConversations();
  const patientConversations = conversations?.filter((c) => c.patientId === patientId) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </Link>

      {isLoading || !patient ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{patient.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label={t("phone")} value={patient.phone || "—"} />
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("tags")}</span>
                <div className="flex flex-wrap gap-1">
                  {(patient.tags ?? []).length > 0 ? (
                    patient.tags!.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">{t("notesPending")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("appointments")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(appointments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noAppointments")}</p>
              ) : (
                appointments!.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span>
                      {a.startAt
                        ? new Intl.DateTimeFormat(locale, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(a.startAt))
                        : "—"}
                    </span>
                    {a.status ? <AppointmentStatusBadge status={a.status} /> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("conversations")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {patientConversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
              ) : (
                patientConversations.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm">
                    {c.channel ? <ChannelBadge channel={c.channel} /> : null}
                    {c.mode ? <ModeBadge mode={c.mode} /> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
