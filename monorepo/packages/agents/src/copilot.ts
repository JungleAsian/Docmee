import { kb, type Database } from "@docmee/db";
import { assembleSystemPrompt, type LlmGateway, type Locale } from "@docmee/llm";

/**
 * Secretary copilot (Phase 3B). Drafts a KB-grounded reply for a HUMAN secretary
 * to review and send — it never delivers anything itself (human-in-the-loop). The
 * draft is grounded the same way the bot is; if KB is thin the copilot says so.
 */
export interface CopilotDeps {
  db: Database;
  gateway: LlmGateway;
}

export interface CopilotSuggestion {
  draft: string;
  grounded: boolean;
  sources: string[];
}

const COPILOT_NOTE: Record<Locale, string> = {
  es: "\n\n[MODO COPILOTO] Redacta un BORRADOR de respuesta para que la secretaria lo revise y envíe. No afirmes nada que no esté en la base de conocimiento.",
  en: "\n\n[COPILOT MODE] Write a DRAFT reply for the secretary to review and send. Do not assert anything not in the knowledge base.",
};

export async function suggestReply(
  deps: CopilotDeps,
  input: { clinicId: string; patientText: string; locale?: Locale; doctorId?: string },
): Promise<CopilotSuggestion> {
  const { db, gateway } = deps;
  const locale: Locale = input.locale ?? "es";
  const embedding = await gateway.embedOne(input.patientText);

  const { rules, snippets } = await db.withClinicContext(input.clinicId, async (tx) => ({
    rules: await kb.getRules(tx),
    snippets: await kb.retrieve(tx, embedding, {
      threshold: kb.RETRIEVAL_THRESHOLD,
      doctorId: input.doctorId,
    }),
  }));

  const system =
    assembleSystemPrompt({
      locale,
      clinicRules: rules,
      kbSnippets: snippets.map((s) => ({ content: s.content, similarity: s.similarity })),
    }) + COPILOT_NOTE[locale];

  const result = await gateway.generate({
    system,
    messages: [{ role: "user", content: input.patientText }],
  });

  return {
    draft: result.text,
    grounded: snippets.length > 0,
    sources: snippets.map((s) => s.content),
  };
}
