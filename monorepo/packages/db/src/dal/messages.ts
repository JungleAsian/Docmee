import type { ClinicTx } from "../types.js";
import type { Keyring } from "../crypto/keyring.js";
import { encrypt, decrypt } from "../crypto/encryption.js";

export interface InsertMessage {
  conversationId: string;
  direction: "inbound" | "outbound";
  author: "patient" | "bot" | "staff";
  content: string;
  providerMessageId?: string | null;
}

export interface InsertResult {
  id: string;
  /** True when the row already existed (idempotent redelivery). */
  duplicate: boolean;
}

/**
 * Insert a message exactly once (decision #7). When a provider_message_id is
 * present, ON CONFLICT DO NOTHING against the (clinic_id, provider_message_id)
 * partial unique index makes redelivery (Meta + BullMQ) a no-op.
 */
export async function insertMessage(
  tx: ClinicTx,
  keyring: Keyring,
  m: InsertMessage,
): Promise<InsertResult> {
  const content = encrypt(m.content, keyring);

  if (m.providerMessageId) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO messages
         (clinic_id, conversation_id, direction, author,
          content_ciphertext, content_key_version, provider_message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (clinic_id, provider_message_id)
         WHERE provider_message_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        tx.clinicId,
        m.conversationId,
        m.direction,
        m.author,
        content.ciphertext,
        content.keyVersion,
        m.providerMessageId,
      ],
    );
    if (rows[0]) return { id: rows[0].id, duplicate: false };

    // Conflict → fetch the existing row's id.
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM messages
       WHERE provider_message_id = $1 LIMIT 1`,
      [m.providerMessageId],
    );
    return { id: existing.rows[0]!.id, duplicate: true };
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO messages
       (clinic_id, conversation_id, direction, author,
        content_ciphertext, content_key_version)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [
      tx.clinicId,
      m.conversationId,
      m.direction,
      m.author,
      content.ciphertext,
      content.keyVersion,
    ],
  );
  return { id: rows[0]!.id, duplicate: false };
}

export interface MessageView {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  author: "patient" | "bot" | "staff";
  body: string;
  createdAt: string;
}

/** Message history for the panel — content decrypted for staff display. */
export async function listMessages(
  tx: ClinicTx,
  keyring: Keyring,
  conversationId: string,
  limit = 50,
): Promise<MessageView[]> {
  const { rows } = await tx.query<{
    id: string;
    conversation_id: string;
    direction: "inbound" | "outbound";
    author: "patient" | "bot" | "staff";
    content_ciphertext: string | null;
    content_key_version: number | null;
    created_at: string;
  }>(
    `SELECT id, conversation_id, direction, author,
            content_ciphertext, content_key_version, created_at
     FROM messages WHERE conversation_id = $1
     ORDER BY created_at ASC LIMIT $2`,
    [conversationId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    author: r.author,
    body:
      r.content_ciphertext && r.content_key_version != null
        ? decrypt(r.content_ciphertext, r.content_key_version, keyring)
        : "",
    createdAt: r.created_at,
  }));
}

export async function countMessages(tx: ClinicTx): Promise<number> {
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages`,
  );
  return Number(rows[0]!.n);
}
