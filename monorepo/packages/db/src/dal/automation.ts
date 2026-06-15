import type { ClinicTx } from "../types.js";

// ── Meta templates ────────────────────────────────────────────────────────────
export async function createTemplate(
  tx: ClinicTx,
  t: { name: string; body: string; language?: string; category?: string; status?: string },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO meta_templates (clinic_id, name, language, category, body, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tx.clinicId, t.name, t.language ?? "es", t.category ?? "utility", t.body, t.status ?? "pending"],
  );
  return rows[0]!;
}

export async function setTemplateStatus(
  tx: ClinicTx,
  id: string,
  status: "pending" | "approved" | "rejected",
): Promise<void> {
  await tx.query(`UPDATE meta_templates SET status = $2 WHERE id = $1`, [id, status]);
}

export async function hasApprovedTemplate(tx: ClinicTx, name: string): Promise<boolean> {
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM meta_templates
     WHERE name = $1 AND status = 'approved'`,
    [name],
  );
  return Number(rows[0]!.n) > 0;
}

// ── Consent ledger ────────────────────────────────────────────────────────────
export async function recordConsent(
  tx: ClinicTx,
  c: { patientId: string; scope?: string; granted: boolean; source?: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO patient_consent (clinic_id, patient_id, scope, granted, source)
     VALUES ($1,$2,$3,$4,$5)`,
    [tx.clinicId, c.patientId, c.scope ?? "transactional", c.granted, c.source ?? null],
  );
}

/** Latest consent decision for a scope (default transactional). */
export async function hasConsent(
  tx: ClinicTx,
  patientId: string,
  scope = "transactional",
): Promise<boolean> {
  const { rows } = await tx.query<{ granted: boolean }>(
    `SELECT granted FROM patient_consent
     WHERE patient_id = $1 AND scope = $2
     ORDER BY created_at DESC LIMIT 1`,
    [patientId, scope],
  );
  return rows[0]?.granted ?? false;
}

// ── Automation rules ──────────────────────────────────────────────────────────
export async function setAutomationRule(
  tx: ClinicTx,
  type: string,
  enabled: boolean,
): Promise<void> {
  await tx.query(
    `INSERT INTO automation_rules (clinic_id, type, enabled) VALUES ($1,$2,$3)
     ON CONFLICT (clinic_id, type) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [tx.clinicId, type, enabled],
  );
}

export async function isAutomationEnabled(tx: ClinicTx, type: string): Promise<boolean> {
  const { rows } = await tx.query<{ enabled: boolean }>(
    `SELECT enabled FROM automation_rules WHERE type = $1`,
    [type],
  );
  return rows[0]?.enabled ?? false;
}

// ── Automation queue ──────────────────────────────────────────────────────────
export interface AutomationJob {
  id: string;
  clinic_id: string;
  patient_id: string;
  conversation_id: string | null;
  appointment_id: string | null;
  type: string;
  status: string;
  template_name: string | null;
}

/** Idempotent enqueue: a duplicate pending (appointment+type) is a no-op. */
export async function enqueueAutomation(
  tx: ClinicTx,
  j: {
    patientId: string;
    type: string;
    conversationId?: string;
    appointmentId?: string;
    runAt?: string;
    templateName?: string;
  },
): Promise<{ id: string | null; duplicate: boolean }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO automation_queue
       (clinic_id, patient_id, conversation_id, appointment_id, type, run_at, template_name)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), $7)
     ON CONFLICT (clinic_id, type, appointment_id)
       WHERE appointment_id IS NOT NULL AND status = 'pending'
       DO NOTHING
     RETURNING id`,
    [
      tx.clinicId,
      j.patientId,
      j.conversationId ?? null,
      j.appointmentId ?? null,
      j.type,
      j.runAt ?? null,
      j.templateName ?? null,
    ],
  );
  return rows[0] ? { id: rows[0].id, duplicate: false } : { id: null, duplicate: true };
}

export async function listDueAutomations(tx: ClinicTx): Promise<AutomationJob[]> {
  const { rows } = await tx.query<AutomationJob>(
    `SELECT * FROM automation_queue WHERE status = 'pending' AND run_at <= now()
     ORDER BY run_at ASC`,
  );
  return rows;
}

export async function markAutomation(
  tx: ClinicTx,
  id: string,
  status: "sent" | "skipped",
  skipReason?: string,
): Promise<void> {
  await tx.query(
    `UPDATE automation_queue
       SET status = $2, skip_reason = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1`,
    [id, status, skipReason ?? null],
  );
}

/** True if a 'sent' automation of this type went out within 48h (frequency cap). */
export async function sentWithin48h(
  tx: ClinicTx,
  patientId: string,
  type: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM automation_queue
     WHERE patient_id = $1 AND type = $2 AND status = 'sent'
       AND sent_at > now() - interval '48 hours'`,
    [patientId, type],
  );
  return Number(rows[0]!.n) > 0;
}

/** Cancellation cascade: cancel all pending automations for an appointment. */
export async function cancelAutomationsForAppointment(
  tx: ClinicTx,
  appointmentId: string,
): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE automation_queue SET status = 'cancelled'
     WHERE appointment_id = $1 AND status = 'pending' RETURNING id`,
    [appointmentId],
  );
  return rows.length;
}
