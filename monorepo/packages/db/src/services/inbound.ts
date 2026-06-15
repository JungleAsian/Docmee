import type { NormalizedInbound } from "@docmee/core";
import type { Database } from "../database.js";
import type { Keyring } from "../crypto/keyring.js";
import { findClinicByChannelRoute } from "../dal/auth.js";
import { logUnrouted } from "../dal/errors.js";
import { upsertPatientByChannelIdentity } from "../dal/patient-channels.js";
import { getOrCreateConversation, markPatientInbound } from "../dal/conversations.js";
import { insertMessage } from "../dal/messages.js";

export type { NormalizedInbound } from "@docmee/core";

export type IngestResult =
  | { status: "unrouted" }
  | {
      status: "stored" | "duplicate";
      clinicId: string;
      messageId: string;
      conversationId: string;
      patientId: string;
    };

/**
 * Inbound pipeline (decision #6): route → upsert patient → ensure conversation →
 * store exactly once. Unknown routingId is logged + dropped (decision #8); never
 * auto-provisioned. No automatic reply in Phase 0 (that begins in 1A).
 */
export async function ingestInbound(
  db: Database,
  keyring: Keyring,
  msg: NormalizedInbound,
): Promise<IngestResult> {
  const clinic = await db.withPlatformContext((tx) =>
    findClinicByChannelRoute(tx, msg.channel, msg.routingId),
  );

  if (!clinic) {
    await db.withPlatformContext((tx) =>
      logUnrouted(tx, { routingId: msg.routingId, channel: msg.channel }),
    );
    return { status: "unrouted" };
  }

  return db.withClinicContext(clinic.id, async (tx) => {
    const patient = await upsertPatientByChannelIdentity(tx, keyring, {
      channel: msg.channel,
      identity: msg.patientIdentifier,
    });
    const conversation = await getOrCreateConversation(tx, patient.id, msg.channel);
    const result = await insertMessage(tx, keyring, {
      conversationId: conversation.id,
      direction: "inbound",
      author: "patient",
      content: msg.content,
      providerMessageId: msg.providerMessageId,
    });
    await markPatientInbound(tx, conversation.id);
    return {
      status: result.duplicate ? "duplicate" : "stored",
      clinicId: clinic.id,
      messageId: result.id,
      conversationId: conversation.id,
      patientId: patient.id,
    };
  });
}
