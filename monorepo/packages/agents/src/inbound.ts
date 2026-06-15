import { ingestInbound, type Database, type Keyring, type OutboundTransport } from "@docmee/db";
import type { NormalizedInbound } from "@docmee/core";
import type { LlmGateway } from "@docmee/llm";
import { processTurn } from "./pipeline.js";

/**
 * The conversation processor for one inbound message: store it (idempotently),
 * then — if freshly stored and in bot mode — run the bot turn. Shared by the API's
 * inline path (no Redis) and the worker's `inbound` queue consumer (with Redis),
 * so both behave identically.
 */
export interface InboundDeps {
  db: Database;
  gateway: LlmGateway;
  keyring: Keyring;
  transport: OutboundTransport;
}

export async function handleInboundMessage(
  deps: InboundDeps,
  msg: NormalizedInbound,
): Promise<void> {
  const res = await ingestInbound(deps.db, deps.keyring, msg);
  if (res.status === "stored") {
    await processTurn(
      {
        db: deps.db,
        gateway: deps.gateway,
        keyring: deps.keyring,
        transport: deps.transport,
      },
      {
        clinicId: res.clinicId,
        conversationId: res.conversationId,
        patientId: res.patientId,
        text: msg.content,
      },
    );
  }
}
