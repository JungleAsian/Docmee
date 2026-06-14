import type { Locale } from "../types.js";

/**
 * Always-injected medical-safety guardrails (architecture principle: the bot never
 * diagnoses, prescribes, or invents facts). Injected in FULL on every request,
 * before any KB content, and never truncated.
 */
const SAFETY_RULES: Record<Locale, string> = {
  es: [
    "Eres el asistente de una clínica médica. Responde SOLO con la información de la base de conocimiento proporcionada.",
    "NUNCA diagnostiques, recetes medicamentos ni des consejos médicos. NUNCA inventes datos.",
    "Si la información no está en la base de conocimiento, dilo con claridad y ofrece transferir con una persona.",
    "Ante una emergencia, indica al paciente que llame al número de emergencias local.",
  ].join("\n"),
  en: [
    "You are a medical clinic assistant. Answer ONLY from the provided knowledge base.",
    "NEVER diagnose, prescribe medication, or give medical advice. NEVER invent facts.",
    "If the information is not in the knowledge base, say so clearly and offer to hand off to a human.",
    "In an emergency, tell the patient to call the local emergency number.",
  ].join("\n"),
};

export interface KbSnippet {
  content: string;
  similarity: number;
}

export interface AssembleOptions {
  locale: Locale;
  /** Clinic "rules" KB category — injected in full, never truncated. */
  clinicRules: string[];
  /** Retrieved KB snippets, truncatable to fit the budget (highest-sim kept). */
  kbSnippets: KbSnippet[];
  /** Char budget proxy for the token limit. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 8000;

/**
 * Assemble the system prompt with FAIL-SAFE TRUNCATION (G): safety rules + clinic
 * rules are always included in full; KB snippets fill the remaining budget in
 * descending similarity, and are dropped (not the rules) if space runs out.
 */
export function assembleSystemPrompt(opts: AssembleOptions): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const safety = SAFETY_RULES[opts.locale];
  const rules = opts.clinicRules.length
    ? `\n\n[REGLAS DE LA CLÍNICA]\n${opts.clinicRules.join("\n")}`
    : "";

  const header = safety + rules;
  let remaining = Math.max(0, maxChars - header.length);

  const sorted = [...opts.kbSnippets].sort((a, b) => b.similarity - a.similarity);
  const kept: string[] = [];
  for (const snip of sorted) {
    const block = snip.content.trim();
    if (block.length + 2 > remaining) break; // drop the rest (fail-safe)
    kept.push(block);
    remaining -= block.length + 2;
  }

  const kb = kept.length ? `\n\n[BASE DE CONOCIMIENTO]\n${kept.join("\n\n")}` : "";
  return header + kb;
}
