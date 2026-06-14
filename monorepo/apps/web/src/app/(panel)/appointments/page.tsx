"use client";

import type { Appointment, AppointmentStatus } from "@docmee/contracts";
import { APPOINTMENT_STATUSES } from "@docmee/contracts";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
} from "@docmee/ui";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { useAppointments, useCreateAppointment } from "../../../lib/api/appointments";
import { useDoctors } from "../../../lib/api/doctors";
import { usePatients } from "../../../lib/api/patients";
import { ApiRequestError } from "../../../lib/api/client";
import { AppointmentStatusBadge } from "../../../components/appointments/status-badge";

export default function AppointmentsPage() {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");
  const [status, setStatus] = useState<AppointmentStatus | undefined>(undefined);
  const [booking, setBooking] = useState(false);
  const { data: appointments, isLoading, isError, refetch } = useAppointments(
    status ? { status } : {},
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {!booking ? (
          <Button size="sm" onClick={() => setBooking(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("new")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        <FilterChip active={status === undefined} onClick={() => setStatus(undefined)}>
          {t("filterAll")}
        </FilterChip>
        {APPOINTMENT_STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setStatus(s)}>
            {t(`status.${s}`)}
          </FilterChip>
        ))}
      </div>

      {booking ? <BookingForm onClose={() => setBooking(false)} /> : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-destructive">{tc("error")}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc("retry")}
          </Button>
        </div>
      ) : !appointments || appointments.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {appointments.map((a) => (
            <li key={a.id}>
              <AppointmentRow appointment={a} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("reschedulePending")}</p>
    </div>
  );
}

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const locale = useLocale();
  const { data: patients } = usePatients();
  const name = patients?.find((p) => p.id === appointment.patientId)?.name ?? appointment.patientId;
  const when = appointment.startAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(appointment.startAt),
      )
    : "—";

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{when}</p>
        </div>
        {appointment.status ? <AppointmentStatusBadge status={appointment.status} /> : null}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" className="h-7 px-2.5" onClick={onClick}>
      {children}
    </Button>
  );
}

function BookingForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("appointments");
  const td = useTranslations("doctors");
  const { data: patients } = usePatients();
  const { data: doctors } = useDoctors();
  const create = useCreateAppointment();
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [conflict, setConflict] = useState(false);

  const canSubmit = useMemo(
    () => Boolean(patientId && start && end),
    [patientId, start, end],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setConflict(false);
    create.mutate(
      {
        patientId,
        ...(doctorId ? { doctorId } : {}),
        startAt: new Date(start).toISOString(),
        endAt: new Date(end).toISOString(),
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409) setConflict(true);
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          {conflict ? <p className="text-sm text-destructive">{t("conflict")}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="a-patient">{t("patient")}</Label>
            <select
              id="a-patient"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              required
            >
              <option value="" disabled>
                {t("selectPatient")}
              </option>
              {(patients ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-doctor">{td("title")}</Label>
            <select
              id="a-doctor"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="">{td("any")}</option>
              {(doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-start">{t("start")}</Label>
              <Input
                id="a-start"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-end">{t("end")}</Label>
              <Input
                id="a-end"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || !canSubmit}>
              {create.isPending ? t("booking") : t("book")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
