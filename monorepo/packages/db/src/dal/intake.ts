import type { ClinicTx } from "../types.js";
import type { Keyring } from "../crypto/keyring.js";
import { encrypt, decrypt } from "../crypto/encryption.js";

/**
 * 8-step resumable booking intake (Phase 1C). State lives in the DB so it survives
 * mode switches and restarts (crash-recovery by design). Collected data is encrypted
 * at rest (it includes PHI: reason). Each write RE-VALIDATES the step input (G19–G25).
 */
export interface IntakeStep {
  key: string;
  prompt: string; // Spanish prompt the bot asks
  validate: (value: string) => boolean;
}

const nonEmpty = (v: string): boolean => v.trim().length > 0;
const affirmative = (v: string): boolean =>
  /^(s[ií]|yes|confirmo|ok|dale)/i.test(v.trim());

export const INTAKE_STEPS: readonly IntakeStep[] = [
  { key: "service", prompt: "¿Qué servicio o motivo de consulta necesita?", validate: nonEmpty },
  { key: "doctorPreference", prompt: "¿Tiene preferencia de doctor? (o diga 'cualquiera')", validate: nonEmpty },
  { key: "preferredDate", prompt: "¿Qué fecha prefiere?", validate: nonEmpty },
  { key: "preferredTime", prompt: "¿Qué hora prefiere?", validate: nonEmpty },
  { key: "patientName", prompt: "¿A nombre de quién agendamos la cita?", validate: nonEmpty },
  { key: "contactPhone", prompt: "¿Un número de contacto?", validate: (v) => v.replace(/\D/g, "").length >= 8 },
  { key: "reason", prompt: "¿Algún detalle adicional que el doctor deba saber?", validate: nonEmpty },
  { key: "confirm", prompt: "¿Confirmo la solicitud de cita? (sí/no)", validate: affirmative },
];

export const INTAKE_STEP_COUNT = INTAKE_STEPS.length;

export interface IntakeState {
  id: string;
  conversationId: string;
  patientId: string;
  status: "in_progress" | "completed" | "abandoned";
  step: number;
  data: Record<string, string>;
}

interface IntakeRow {
  id: string;
  conversation_id: string;
  patient_id: string;
  status: IntakeState["status"];
  step: number;
  data_ciphertext: string | null;
  data_key_version: number | null;
}

function toState(row: IntakeRow, keyring: Keyring): IntakeState {
  const data =
    row.data_ciphertext && row.data_key_version != null
      ? (JSON.parse(decrypt(row.data_ciphertext, row.data_key_version, keyring)) as Record<
          string,
          string
        >)
      : {};
  return {
    id: row.id,
    conversationId: row.conversation_id,
    patientId: row.patient_id,
    status: row.status,
    step: Number(row.step),
    data,
  };
}

const COLS = `id, conversation_id, patient_id, status, step, data_ciphertext, data_key_version`;

/** Resume the conversation's active intake, or start a new one. */
export async function getOrCreateIntake(
  tx: ClinicTx,
  keyring: Keyring,
  conversationId: string,
  patientId: string,
): Promise<IntakeState> {
  const existing = await tx.query<IntakeRow>(
    `SELECT ${COLS} FROM patient_intake
     WHERE conversation_id = $1 AND status = 'in_progress'
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  if (existing.rows[0]) return toState(existing.rows[0], keyring);

  const created = await tx.query<IntakeRow>(
    `INSERT INTO patient_intake (clinic_id, conversation_id, patient_id)
     VALUES ($1, $2, $3) RETURNING ${COLS}`,
    [tx.clinicId, conversationId, patientId],
  );
  return toState(created.rows[0]!, keyring);
}

export interface AdvanceResult {
  state: IntakeState;
  accepted: boolean;
  done: boolean;
  /** The next prompt to ask, or null when complete. */
  nextPrompt: string | null;
}

/**
 * Record the patient's answer for the CURRENT step (re-validated on write) and
 * advance. Invalid input is rejected (not stored); the same step is re-asked.
 */
export async function advanceIntake(
  tx: ClinicTx,
  keyring: Keyring,
  intakeId: string,
  value: string,
): Promise<AdvanceResult> {
  const { rows } = await tx.query<IntakeRow>(
    `SELECT ${COLS} FROM patient_intake WHERE id = $1`,
    [intakeId],
  );
  const state = toState(rows[0]!, keyring);
  if (state.status !== "in_progress") {
    return { state, accepted: false, done: state.status === "completed", nextPrompt: null };
  }

  const step = INTAKE_STEPS[state.step]!;
  if (!step.validate(value)) {
    return { state, accepted: false, done: false, nextPrompt: step.prompt };
  }

  const data = { ...state.data, [step.key]: value.trim() };
  const nextStep = state.step + 1;
  const done = nextStep >= INTAKE_STEP_COUNT;
  const enc = encrypt(JSON.stringify(data), keyring);

  const updated = await tx.query<IntakeRow>(
    `UPDATE patient_intake
       SET data_ciphertext = $2, data_key_version = $3, step = $4,
           status = $5, updated_at = now()
     WHERE id = $1 RETURNING ${COLS}`,
    [intakeId, enc.ciphertext, enc.keyVersion, nextStep, done ? "completed" : "in_progress"],
  );
  const newState = toState(updated.rows[0]!, keyring);
  return {
    state: newState,
    accepted: true,
    done,
    nextPrompt: done ? null : INTAKE_STEPS[nextStep]!.prompt,
  };
}

export async function abandonIntake(tx: ClinicTx, intakeId: string): Promise<void> {
  await tx.query(
    `UPDATE patient_intake SET status = 'abandoned', updated_at = now() WHERE id = $1`,
    [intakeId],
  );
}
