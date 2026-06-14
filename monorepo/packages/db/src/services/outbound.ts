import type { Database } from "../database.js";
import type { Keyring } from "../crypto/keyring.js";
import { insertMessage } from "../dal/messages.js";
import { touchConversation } from "../dal/conversations.js";

/** Transport that physically delivers a message (Meta / Evolution adapter). */
export interface OutboundTransport {
  send(params: {
    clinicId: string;
    patientId: string;
    content: string;
  }): Promise<{ providerMessageId?: string }>;
}

export interface OutboundParams {
  clinicId: string;
  conversationId: string;
  patientId: string;
  author: "bot" | "staff";
  content: string;
}

export type OutboundResult =
  | { status: "suppressed"; reason: "opted_out" }
  | { status: "sent"; messageId: string };

/**
 * THE outbound chokepoint (decision #5/#6). Every outbound message passes here.
 * Opted-out patients are suppressed BEFORE anything is sent — the single point
 * where suppression is enforced. (Proactive six-gate checks layer on in 2C.)
 */
export async function sendOutbound(
  db: Database,
  keyring: Keyring,
  transport: OutboundTransport,
  params: OutboundParams,
): Promise<OutboundResult> {
  const allowed = await db.withClinicContext(params.clinicId, async (tx) => {
    const { rows } = await tx.query<{ opted_out: boolean }>(
      `SELECT opted_out FROM patients WHERE id = $1`,
      [params.patientId],
    );
    return rows[0] ? !rows[0].opted_out : false;
  });

  if (!allowed) {
    return { status: "suppressed", reason: "opted_out" };
  }

  const sent = await transport.send({
    clinicId: params.clinicId,
    patientId: params.patientId,
    content: params.content,
  });

  const messageId = await db.withClinicContext(params.clinicId, async (tx) => {
    const result = await insertMessage(tx, keyring, {
      conversationId: params.conversationId,
      direction: "outbound",
      author: params.author,
      content: params.content,
      providerMessageId: sent.providerMessageId ?? null,
    });
    await touchConversation(tx, params.conversationId);
    return result.id;
  });

  return { status: "sent", messageId };
}
