// Screen 8 (Bot tone & clinic rules) — structured clinic-rule list with a per-rule
// ACTIVE/INACTIVE state (the brief's "rule editor with active/inactive states").
//
// The agents layer (apps/workers agent-processor + apps/api assistant) reads the bot
// rules from the FLAT string settings.clinicRules. We keep that contract: on every
// save the panel recompiles settings.clinicRules from only the ACTIVE rules, so
// toggling a rule off removes it from the bot prompt WITHOUT losing the text. The
// structured list itself (text + active flag, including inactive rules) is persisted
// alongside it under settings.clinicRulesList.
//
// This module is pure (no Date/random) so it can be unit-tested; new-rule id
// generation lives in the component.

export interface ClinicRule {
  id: string
  text: string
  active: boolean
}

interface RuleSettings {
  clinicRules?: unknown
  clinicRulesList?: unknown
}

// Read the editable rule list from clinic.settings. Prefers the structured list;
// falls back to migrating a legacy free-text clinicRules blob (one rule per
// non-empty line, all active) so existing clinics keep their configured rules.
export function parseClinicRules(settings: RuleSettings): ClinicRule[] {
  const list = settings.clinicRulesList
  if (Array.isArray(list)) {
    return list
      .map((raw, i) => normalizeRule(raw, i))
      .filter((r): r is ClinicRule => r !== null)
  }
  const legacy = settings.clinicRules
  if (typeof legacy === 'string' && legacy.trim() !== '') {
    return legacy
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((text, i) => ({ id: `legacy-${i}`, text, active: true }))
  }
  return []
}

function normalizeRule(raw: unknown, index: number): ClinicRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { id?: unknown; text?: unknown; active?: unknown }
  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (text === '') return null
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : `rule-${index}`,
    text,
    // Default to active so a rule with a missing/garbled flag is never silently
    // dropped from the bot; only an explicit `false` makes a rule inactive.
    active: r.active !== false,
  }
}

// Compile the flat string the agents layer reads. Only ACTIVE, non-empty rules are
// included — an inactive rule is kept for editing but is invisible to the bot.
// Returns '' when no active rules remain (the readers collapse '' to "no rules").
export function compileActiveRules(rules: ClinicRule[]): string {
  return rules
    .filter((r) => r.active && r.text.trim() !== '')
    .map((r) => r.text.trim())
    .join('\n')
}

// True when the rule list differs from what is persisted (content + active state +
// order), used to drive the section's dirty/Save affordance.
export function rulesChanged(a: ClinicRule[], b: ClinicRule[]): boolean {
  if (a.length !== b.length) return true
  return a.some((r, i) => r.text !== b[i]!.text || r.active !== b[i]!.active)
}
