import type { ClinicTx } from "../types.js";

export interface ConversationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  channel: string;
  mode: string;
  assignee_id: string | null;
  last_interaction_at: string;
  window_expires_at: string | null;
}

export type Channel = "whatsapp" | "messenger" | "instagram";

/** Get the patient's conversation for a channel, creating it if absent. */
export async function getOrCreateConversation(
  tx: ClinicTx,
  patientId: string,
  channel: Channel,
): Promise<ConversationRow> {
  const existing = await tx.query<ConversationRow>(
    `SELECT * FROM conversations
     WHERE patient_id = $1 AND channel = $2
     ORDER BY last_interaction_at DESC LIMIT 1`,
    [patientId, channel],
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await tx.query<ConversationRow>(
    `INSERT INTO conversations (clinic_id, patient_id, channel)
     VALUES ($1, $2, $3) RETURNING *`,
    [tx.clinicId, patientId, channel],
  );
  return created.rows[0]!;
}

export async function touchConversation(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(
    `UPDATE conversations SET last_interaction_at = now() WHERE id = $1`,
    [id],
  );
}

export async function getConversation(
  tx: ClinicTx,
  id: string,
): Promise<ConversationRow | null> {
  const { rows } = await tx.query<ConversationRow>(
    `SELECT * FROM conversations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Patient inbound: refresh activity and (re)open the 24h messaging window. */
export async function markPatientInbound(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(
    `UPDATE conversations
       SET last_interaction_at = now(),
           window_expires_at = now() + interval '24 hours'
     WHERE id = $1`,
    [id],
  );
}

/** True if the 24h customer-service window is currently open. */
export async function isWindowOpen(tx: ClinicTx, id: string): Promise<boolean> {
  const { rows } = await tx.query<{ open: boolean }>(
    `SELECT (window_expires_at IS NOT NULL AND window_expires_at > now()) AS open
     FROM conversations WHERE id = $1`,
    [id],
  );
  return rows[0]?.open ?? false;
}

/** A human takes over — the bot stops auto-replying (never interrupts a human). */
export async function pauseForHuman(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(`UPDATE conversations SET mode = 'human' WHERE id = $1`, [id]);
}

/** Self-healing handback: control returns to the bot. */
export async function handBackToBot(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(`UPDATE conversations SET mode = 'bot' WHERE id = $1`, [id]);
}

export async function setMode(
  tx: ClinicTx,
  id: string,
  mode: "bot" | "human" | "paused" | "resolved",
): Promise<ConversationRow | null> {
  const { rows } = await tx.query<ConversationRow>(
    `UPDATE conversations SET mode = $2 WHERE id = $1 RETURNING *`,
    [id, mode],
  );
  return rows[0] ?? null;
}
