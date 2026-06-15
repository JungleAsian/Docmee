import type { ClinicTx } from "../types.js";

/**
 * Doctor entity (Phase 3A). Activates the doctors + staff_doctor_assignments seam.
 * Each doctor may have its own Google calendar (calendar_id) and doctor-scoped KB.
 */
export interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  active: boolean;
  calendar_id: string | null;
}

export async function createDoctor(
  tx: ClinicTx,
  d: { name: string; specialty?: string; calendarId?: string },
): Promise<Doctor> {
  const { rows } = await tx.query<Doctor>(
    `INSERT INTO doctors (clinic_id, name, specialty, calendar_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, specialty, active, calendar_id`,
    [tx.clinicId, d.name, d.specialty ?? null, d.calendarId ?? null],
  );
  return rows[0]!;
}

export async function listDoctors(
  tx: ClinicTx,
  opts: { activeOnly?: boolean } = {},
): Promise<Doctor[]> {
  const { rows } = await tx.query<Doctor>(
    `SELECT id, name, specialty, active, calendar_id FROM doctors
     ${opts.activeOnly ? "WHERE active = true" : ""}
     ORDER BY name`,
  );
  return rows;
}

export async function setDoctorActive(
  tx: ClinicTx,
  id: string,
  active: boolean,
): Promise<void> {
  await tx.query(`UPDATE doctors SET active = $2 WHERE id = $1`, [id, active]);
}

/** Assign a staff member (clinic_user) to a doctor (many-to-many). */
export async function assignStaffToDoctor(
  tx: ClinicTx,
  clinicUserId: string,
  doctorId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO staff_doctor_assignments (clinic_user_id, doctor_id, clinic_id)
     VALUES ($1, $2, $3) ON CONFLICT (clinic_user_id, doctor_id) DO NOTHING`,
    [clinicUserId, doctorId, tx.clinicId],
  );
}

export async function listDoctorsForStaff(
  tx: ClinicTx,
  clinicUserId: string,
): Promise<Doctor[]> {
  const { rows } = await tx.query<Doctor>(
    `SELECT d.id, d.name, d.specialty, d.active, d.calendar_id
     FROM doctors d
     JOIN staff_doctor_assignments a ON a.doctor_id = d.id
     WHERE a.clinic_user_id = $1
     ORDER BY d.name`,
    [clinicUserId],
  );
  return rows;
}
