import {
  conversations,
  kb,
  audit,
  sendOutbound,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import {
  assembleSystemPrompt,
  INTENTS,
  type LlmGateway,
  type Locale,
} from "@docmee/llm";

export interface PipelineDeps {
  db: Database;
  gateway: LlmGateway;
  keyring: Keyring;
  transport: OutboundTransport;
}

export interface TurnInput {
  clinicId: string;
  conversationId: string;
  patientId: string;
  text: string;
  locale?: Locale;
}

export type TurnResult =
  | { action: "skipped"; reason: string }
  | { action: "replied"; text: string }
  | { action: "handoff" }
  | { action: "gap" }
  | { action: "suppressed" };

const GAP_MESSAGE: Record<Locale, string> = {
  es: "No tengo esa información a la mano. Te comunico con una persona de la clínica para ayudarte.",
  en: "I don't have that information on hand. Let me connect you with someone from the clinic.",
};
const HANDOFF_MESSAGE: Record<Locale, string> = {
  es: "Con gusto te comunico con una persona de la clínica.",
  en: "I'll connect you with someone from the clinic.",
};

/**
 * One conversation turn (architecture §3/§4). Ordered chain:
 *   1. interruption check — the bot NEVER replies when a human is active.
 *   2. intent classification (DeepSeek via the gateway).
 *   3. route: handoff/booking/status → escalate to a human; question/other → KB.
 *   4. KB grounding — below the 0.70 threshold the bot does NOT use general LLM
 *      knowledge; it acknowledges the gap and hands off.
 *   5. deliver through the outbound chokepoint (opt-out enforced there).
 */
export async function processTurn(
  deps: PipelineDeps,
  input: TurnInput,
): Promise<TurnResult> {
  const { db, gateway, keyring, transport } = deps;
  const locale: Locale = input.locale ?? "es";

  // 1. Interruption check.
  const conv = await db.withClinicContext(input.clinicId, (tx) =>
    conversations.getConversation(tx, input.conversationId),
  );
  if (!conv) return { action: "skipped", reason: "no_conversation" };
  if (conv.mode !== "bot") return { action: "skipped", reason: "not_bot_mode" };

  // 2. Intent.
  const { intent } = await gateway.classifyIntent(input.text, INTENTS);

  // 3. Route. Scheduling intents escalate until Phase 1C lands.
  if (intent === "handoff" || intent === "booking" || intent === "appointment_status") {
    return escalate(deps, input, locale, HANDOFF_MESSAGE[locale], { intent });
  }

  // 4. KB-grounded answer.
  const embedding = await gateway.embedOne(input.text);
  const { rules, snippets } = await db.withClinicContext(input.clinicId, async (tx) => ({
    rules: await kb.getRules(tx),
    snippets: await kb.retrieve(tx, embedding, { threshold: kb.RETRIEVAL_THRESHOLD }),
  }));

  if (snippets.length === 0) {
    return escalate(deps, input, locale, GAP_MESSAGE[locale], { reason: "kb_gap" });
  }

  const system = assembleSystemPrompt({
    locale,
    clinicRules: rules,
    kbSnippets: snippets.map((s) => ({ content: s.content, similarity: s.similarity })),
  });
  const result = await gateway.generate({
    system,
    messages: [{ role: "user", content: input.text }],
  });

  const sent = await sendOutbound(db, keyring, transport, {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    author: "bot",
    content: result.text,
  });
  if (sent.status === "suppressed") return { action: "suppressed" };
  return { action: "replied", text: result.text };
}

/** Send an ack and hand the conversation to a human (self-healing handback later). */
async function escalate(
  deps: PipelineDeps,
  input: TurnInput,
  _locale: Locale,
  ackMessage: string,
  detail: Record<string, unknown>,
): Promise<TurnResult> {
  const { db, keyring, transport } = deps;
  const sent = await sendOutbound(db, keyring, transport, {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    author: "bot",
    content: ackMessage,
  });
  await db.withClinicContext(input.clinicId, async (tx) => {
    await conversations.pauseForHuman(tx, input.conversationId);
    await audit.writeAudit(tx, {
      action: "bot.handoff",
      target: input.conversationId,
      detail,
    });
  });
  if (sent.status === "suppressed") return { action: "suppressed" };
  return detail["reason"] === "kb_gap" ? { action: "gap" } : { action: "handoff" };
}
