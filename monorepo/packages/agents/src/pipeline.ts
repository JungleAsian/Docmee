import {
  conversations,
  kb,
  audit,
  intake,
  appointments,
  notifications,
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
  | { action: "intake"; done: boolean }
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
const BOOKING_DONE: Record<Locale, string> = {
  es: "¡Gracias! Recibimos tu solicitud de cita. Una persona de la clínica te confirmará el horario en breve.",
  en: "Thank you! We received your appointment request. Someone from the clinic will confirm the time shortly.",
};
const NO_APPT: Record<Locale, string> = {
  es: "No encuentro citas próximas a tu nombre. ¿Deseas agendar una?",
  en: "I don't see any upcoming appointments for you. Would you like to book one?",
};

/**
 * One conversation turn (architecture §3/§4). Ordered chain:
 *   1. interruption check — the bot NEVER replies when a human is active.
 *   2. active intake — if a booking is in progress, the message is its next answer.
 *   3. intent — handoff escalates; appointment_status answers; booking starts intake;
 *      question/other go to KB grounding (≥0.70, else acknowledge gap + hand off).
 *   4. deliver through the outbound opt-out chokepoint.
 */
export async function processTurn(
  deps: PipelineDeps,
  input: TurnInput,
): Promise<TurnResult> {
  const { db, gateway } = deps;
  const locale: Locale = input.locale ?? "es";

  const conv = await db.withClinicContext(input.clinicId, (tx) =>
    conversations.getConversation(tx, input.conversationId),
  );
  if (!conv) return { action: "skipped", reason: "no_conversation" };
  if (conv.mode !== "bot") return { action: "skipped", reason: "not_bot_mode" };

  // 2. Continue an in-progress intake before classifying intent.
  const active = await db.withClinicContext(input.clinicId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM patient_intake
       WHERE conversation_id = $1 AND status = 'in_progress' LIMIT 1`,
      [input.conversationId],
    );
    return rows[0]?.id ?? null;
  });
  if (active) return continueIntake(deps, input, locale, active);

  // 3. Intent.
  const { intent } = await gateway.classifyIntent(input.text, INTENTS);

  if (intent === "handoff") {
    return escalate(deps, input, HANDOFF_MESSAGE[locale], { intent });
  }
  if (intent === "appointment_status") {
    return appointmentStatus(deps, input, locale);
  }
  if (intent === "booking") {
    return startIntake(deps, input);
  }
  return answerFromKb(deps, input, locale);
}

async function startIntake(deps: PipelineDeps, input: TurnInput): Promise<TurnResult> {
  const { db, keyring } = deps;
  const firstPrompt = await db.withClinicContext(input.clinicId, async (tx) => {
    const state = await intake.getOrCreateIntake(
      tx,
      keyring,
      input.conversationId,
      input.patientId,
    );
    return intake.INTAKE_STEPS[state.step]!.prompt;
  });
  return reply(deps, input, firstPrompt, "intake-start");
}

async function continueIntake(
  deps: PipelineDeps,
  input: TurnInput,
  locale: Locale,
  intakeId: string,
): Promise<TurnResult> {
  const { db, keyring } = deps;
  const result = await db.withClinicContext(input.clinicId, (tx) =>
    intake.advanceIntake(tx, keyring, intakeId, input.text),
  );

  if (result.done) {
    // Booking request complete → hand the exact-slot placement to a human and
    // notify staff (precise datetime stays human-finalized; reschedule/cancel too).
    await db.withClinicContext(input.clinicId, async (tx) => {
      await notifications.createNotification(tx, {
        priority: "P2",
        type: "appointment_request",
        conversationId: input.conversationId,
        patientId: input.patientId,
        body: "Patient completed booking intake.",
      });
      await conversations.pauseForHuman(tx, input.conversationId);
      await audit.writeAudit(tx, {
        action: "bot.intake_completed",
        target: input.conversationId,
      });
    });
    const sent = await sendOutbound(deps.db, deps.keyring, deps.transport, {
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      patientId: input.patientId,
      author: "bot",
      content: BOOKING_DONE[locale],
    });
    if (sent.status === "suppressed") return { action: "suppressed" };
    return { action: "intake", done: true };
  }

  const sent = await sendOutbound(deps.db, deps.keyring, deps.transport, {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    author: "bot",
    content: result.nextPrompt!,
  });
  if (sent.status === "suppressed") return { action: "suppressed" };
  return { action: "intake", done: false };
}

async function appointmentStatus(
  deps: PipelineDeps,
  input: TurnInput,
  locale: Locale,
): Promise<TurnResult> {
  const appt = await deps.db.withClinicContext(input.clinicId, (tx) =>
    appointments.getUpcomingForPatient(tx, input.patientId),
  );
  const when = appt ? new Date(appt.start_at).toISOString() : "";
  const text = appt
    ? locale === "es"
      ? `Tu próxima cita está ${appt.status === "confirmed" ? "confirmada" : "agendada"} para ${when}.`
      : `Your next appointment is ${appt.status} for ${when}.`
    : NO_APPT[locale];
  return reply(deps, input, text, "appointment_status");
}

async function answerFromKb(
  deps: PipelineDeps,
  input: TurnInput,
  locale: Locale,
): Promise<TurnResult> {
  const { db, gateway } = deps;
  const embedding = await gateway.embedOne(input.text);
  const { rules, snippets } = await db.withClinicContext(input.clinicId, async (tx) => ({
    rules: await kb.getRules(tx),
    snippets: await kb.retrieve(tx, embedding, { threshold: kb.RETRIEVAL_THRESHOLD }),
  }));

  if (snippets.length === 0) {
    return escalate(deps, input, GAP_MESSAGE[locale], { reason: "kb_gap" });
  }

  const system = assembleSystemPrompt({
    locale,
    clinicRules: rules,
    kbSnippets: snippets.map((s) => ({ content: s.content, similarity: s.similarity })),
  });
  const generated = await gateway.generate({
    system,
    messages: [{ role: "user", content: input.text }],
  });
  return reply(deps, input, generated.text, "kb_answer");
}

/** Send a bot reply through the chokepoint. */
async function reply(
  deps: PipelineDeps,
  input: TurnInput,
  text: string,
  _kind: string,
): Promise<TurnResult> {
  const sent = await sendOutbound(deps.db, deps.keyring, deps.transport, {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    author: "bot",
    content: text,
  });
  if (sent.status === "suppressed") return { action: "suppressed" };
  return { action: "replied", text };
}

async function escalate(
  deps: PipelineDeps,
  input: TurnInput,
  ackMessage: string,
  detail: Record<string, unknown>,
): Promise<TurnResult> {
  const sent = await sendOutbound(deps.db, deps.keyring, deps.transport, {
    clinicId: input.clinicId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    author: "bot",
    content: ackMessage,
  });
  await deps.db.withClinicContext(input.clinicId, async (tx) => {
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
