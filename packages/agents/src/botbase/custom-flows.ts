// P18 (Gap #34): Custom conversation flows.
//
// Pure matching for clinic-defined, keyword-triggered scripted flows. The agent
// pipeline evaluates these BEFORE intent classification / the LLM: if an inbound
// message matches a flow's trigger keyword, the bot runs the flow's canned message
// sequence (and optional terminal action) instead of calling the model.
//
// Mirrors the rest of botbase: no DB/LLM imports — the worker loads flows and
// passes them in, this module just decides what matches.
import type { Language } from './language-detector.js'

export type CustomFlowAction = 'book' | 'handoff' | 'end'
export type CustomFlowLanguage = 'es' | 'en' | 'both'

/** The slice of a custom flow the matcher needs (worker maps the DB row to this). */
export interface CustomFlowDef {
  id: string
  triggerKeywords: string[]
  messages: string[]
  action?: CustomFlowAction | null
  language: CustomFlowLanguage
}

/** Lowercase + drop accents so "precio" matches "précio". */
function deaccent(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Lowercase, de-accent, and split into whole-word tokens. */
function tokenize(text: string): string[] {
  return deaccent(text)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

/** True when the message contains the keyword (multi-word keywords match as a phrase). */
function messageMatchesKeyword(messageTokens: string[], keyword: string): boolean {
  const norm = deaccent(keyword).trim()
  if (!norm) return false
  const parts = norm.split(/\s+/)
  if (parts.length === 1) return messageTokens.includes(parts[0]!)
  // Phrase: all parts present as a contiguous run.
  const joined = ` ${messageTokens.join(' ')} `
  return joined.includes(` ${parts.join(' ')} `)
}

/**
 * Return the first enabled flow whose trigger matches `message` for the given
 * language, or null. Flows are checked in the order supplied (clinic order).
 */
export function matchCustomFlow(
  message: string,
  flows: CustomFlowDef[],
  language: Language,
): CustomFlowDef | null {
  const tokens = tokenize(message)
  if (tokens.length === 0) return null

  for (const flow of flows) {
    if (flow.language !== 'both' && flow.language !== language) continue
    if (flow.triggerKeywords.some((kw) => messageMatchesKeyword(tokens, kw))) return flow
  }
  return null
}
