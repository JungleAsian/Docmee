import { appointments, type Database } from "@docmee/db";
import type { CalendarProvider } from "@docmee/integrations";

/**
 * Booking service (Phase 1C). Google Calendar is the datetime source of truth, so
 * we check Calendar free/busy AND local appointments before creating — no
 * double-book (G19–G25). The Calendar event is created first (truth), then the
 * local appointment retains its event id.
 */
export interface BookingDeps {
  db: Database;
  /** The clinic's calendar (resolved per-clinic in production). */
  calendar: CalendarProvider;
}

export interface BookParams {
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
  startAt: string;
  endAt: string;
  summary: string;
  description?: string;
}

export type BookResult =
  | { status: "conflict" }
  | { status: "booked"; appointment: appointments.AppointmentRow };

export async function bookAppointment(
  deps: BookingDeps,
  params: BookParams,
): Promise<BookResult> {
  const { db, calendar } = deps;

  // Calendar is the source of truth for availability.
  const busy = await calendar.freeBusy(params.startAt, params.endAt);
  if (busy.length > 0) return { status: "conflict" };

  const localOverlap = await db.withClinicContext(params.clinicId, (tx) =>
    appointments.hasOverlap(tx, params.startAt, params.endAt, params.doctorId),
  );
  if (localOverlap) return { status: "conflict" };

  const { eventId } = await calendar.createEvent({
    startAt: params.startAt,
    endAt: params.endAt,
    summary: params.summary,
    description: params.description,
  });

  const appointment = await db.withClinicContext(params.clinicId, (tx) =>
    appointments.createAppointment(tx, {
      patientId: params.patientId,
      doctorId: params.doctorId ?? null,
      startAt: params.startAt,
      endAt: params.endAt,
      calendarEventId: eventId,
    }),
  );
  return { status: "booked", appointment };
}
