import type { ClinicTx } from "../types.js";

export type AppointmentStatus =
  | "booked"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface AppointmentRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string | null;
  status: AppointmentStatus;
  start_at: string;
  end_at: string;
  calendar_event_id: string | null;
  created_at: string;
}

/** Allowed status transitions (lifecycle). Reschedule/cancel stay human-driven. */
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["confirmed", "completed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function createAppointment(
  tx: ClinicTx,
  a: {
    patientId: string;
    doctorId?: string | null;
    startAt: string;
    endAt: string;
    calendarEventId?: string | null;
    status?: AppointmentStatus;
  },
): Promise<AppointmentRow> {
  const status = a.status ?? "booked";
  const { rows } = await tx.query<AppointmentRow>(
    `INSERT INTO appointments
       (clinic_id, patient_id, doctor_id, status, start_at, end_at, calendar_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      tx.clinicId,
      a.patientId,
      a.doctorId ?? null,
      status,
      a.startAt,
      a.endAt,
      a.calendarEventId ?? null,
    ],
  );
  const appt = rows[0]!;
  await tx.query(
    `INSERT INTO appointment_status_log (clinic_id, appointment_id, from_status, to_status)
     VALUES ($1, $2, NULL, $3)`,
    [tx.clinicId, appt.id, status],
  );
  return appt;
}

/** True if a non-cancelled local appointment overlaps [startAt,endAt) (no double-book). */
export async function hasOverlap(
  tx: ClinicTx,
  startAt: string,
  endAt: string,
  doctorId?: string | null,
): Promise<boolean> {
  const params: unknown[] = [startAt, endAt];
  let doctorClause = "";
  if (doctorId) {
    params.push(doctorId);
    doctorClause = `AND doctor_id = $3`;
  }
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM appointments
     WHERE status NOT IN ('cancelled','no_show')
       AND start_at < $2 AND $1 < end_at ${doctorClause}`,
    params,
  );
  return Number(rows[0]!.n) > 0;
}

export async function listAppointments(
  tx: ClinicTx,
  f: { patientId?: string; status?: AppointmentStatus } = {},
): Promise<AppointmentRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.patientId) {
    params.push(f.patientId);
    where.push(`patient_id = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}`);
  }
  const { rows } = await tx.query<AppointmentRow>(
    `SELECT * FROM appointments
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY start_at DESC`,
    params,
  );
  return rows;
}

/** The patient's next upcoming non-terminal appointment (bot status query). */
export async function getUpcomingForPatient(
  tx: ClinicTx,
  patientId: string,
): Promise<AppointmentRow | null> {
  const { rows } = await tx.query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE patient_id = $1 AND status IN ('booked','confirmed') AND end_at > now()
     ORDER BY start_at ASC LIMIT 1`,
    [patientId],
  );
  return rows[0] ?? null;
}

export class InvalidTransitionError extends Error {}

export async function transitionStatus(
  tx: ClinicTx,
  id: string,
  toStatus: AppointmentStatus,
  actorClinicUserId?: string,
): Promise<AppointmentRow> {
  const { rows } = await tx.query<AppointmentRow>(
    `SELECT * FROM appointments WHERE id = $1`,
    [id],
  );
  const appt = rows[0];
  if (!appt) throw new InvalidTransitionError("appointment not found");
  if (!TRANSITIONS[appt.status].includes(toStatus)) {
    throw new InvalidTransitionError(`${appt.status} -> ${toStatus} not allowed`);
  }
  const updated = await tx.query<AppointmentRow>(
    `UPDATE appointments SET status = $2 WHERE id = $1 RETURNING *`,
    [id, toStatus],
  );
  await tx.query(
    `INSERT INTO appointment_status_log
       (clinic_id, appointment_id, from_status, to_status, actor_clinic_user_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [tx.clinicId, id, appt.status, toStatus, actorClinicUserId ?? null],
  );
  return updated.rows[0]!;
}

/** Appointments due for auto-completion: 30+ min past end, still booked/confirmed. */
export async function findDueForCompletion(tx: ClinicTx): Promise<AppointmentRow[]> {
  const { rows } = await tx.query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE status IN ('booked','confirmed') AND end_at < now() - interval '30 minutes'`,
  );
  return rows;
}
