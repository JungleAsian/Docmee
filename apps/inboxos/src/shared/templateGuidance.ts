// Screen 4 (Quick replies & templates) — WhatsApp template guidance. WhatsApp
// HSM (Highly Structured Message) templates must pass Meta review before a clinic
// can send them, and Meta rejects common authoring mistakes (non-sequential
// {{n}} placeholders, parameters touching with no text between them, a body that
// opens or closes on a parameter, an over-long body, or a non-conforming name).
//
// This module derives those issues from a template body + name purely, so the IA
// Studio editor can warn the admin BEFORE they submit to Meta instead of after a
// rejection. It mirrors the guidance Meta publishes for message templates; it does
// not call Meta — submission stays manual (see routes/templates.ts).
import type { MessageTemplateCategory } from './types'

/** Meta caps the message body at 1024 characters. */
export const TEMPLATE_BODY_MAX = 1024
/** Meta caps the template name at 512 characters (lowercase a–z, 0–9, _). */
export const TEMPLATE_NAME_MAX = 512

export type TemplateSeverity = 'error' | 'warning'

// `error` = Meta will reject; `warning` = allowed but discouraged / fragile.
export type TemplateIssueCode =
  | 'body_empty'
  | 'body_too_long'
  | 'vars_not_sequential'
  | 'vars_adjacent'
  | 'var_at_start'
  | 'var_at_end'
  | 'name_format'
  | 'name_too_long'

export interface TemplateIssue {
  code: TemplateIssueCode
  severity: TemplateSeverity
}

export interface TemplateAnalysis {
  /** Distinct numbered placeholders in ascending order, e.g. [1, 2]. */
  variables: number[]
  charCount: number
  issues: TemplateIssue[]
  /** True when there are no error-severity issues (safe to submit to Meta). */
  valid: boolean
}

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g
// Two placeholders separated only by whitespace (Meta requires text between them).
const ADJACENT_RE = /\}\}\s*\{\{/
// A body that opens or closes on a placeholder.
const STARTS_WITH_VAR_RE = /^\s*\{\{\s*\d+\s*\}\}/
const ENDS_WITH_VAR_RE = /\{\{\s*\d+\s*\}\}\s*$/
const NAME_RE = /^[a-z0-9_]+$/

/**
 * Numbered placeholders found in `body`, in first-appearance order, with
 * duplicates kept. Use `analyzeTemplate().variables` for the distinct ordered set.
 */
export function extractVariables(body: string): number[] {
  const found: number[] = []
  for (const match of body.matchAll(VAR_RE)) {
    found.push(Number(match[1]))
  }
  return found
}

/** Whether the distinct numbers are exactly 1..n with no gaps and no repeats logic. */
function isSequentialFromOne(distinct: number[]): boolean {
  return distinct.every((n, i) => n === i + 1)
}

/**
 * Analyze a template body (and optionally its name) against Meta's HSM rules.
 * `name` is optional because the body is editable on its own in the row editor.
 */
export function analyzeTemplate(body: string, name?: string): TemplateAnalysis {
  const issues: TemplateIssue[] = []
  const trimmed = body.trim()
  const charCount = body.length

  // Distinct numbered placeholders, ascending — what Meta substitutes at send time.
  const variables = Array.from(new Set(extractVariables(body))).sort((a, b) => a - b)

  if (trimmed.length === 0) {
    issues.push({ code: 'body_empty', severity: 'error' })
  }
  if (charCount > TEMPLATE_BODY_MAX) {
    issues.push({ code: 'body_too_long', severity: 'error' })
  }
  if (variables.length > 0 && !isSequentialFromOne(variables)) {
    issues.push({ code: 'vars_not_sequential', severity: 'error' })
  }
  if (ADJACENT_RE.test(body)) {
    issues.push({ code: 'vars_adjacent', severity: 'error' })
  }
  // Start/end placeholders are accepted by Meta but commonly cause rejections for
  // utility/marketing categories, so they are surfaced as warnings, not errors.
  if (trimmed.length > 0 && STARTS_WITH_VAR_RE.test(body)) {
    issues.push({ code: 'var_at_start', severity: 'warning' })
  }
  if (trimmed.length > 0 && ENDS_WITH_VAR_RE.test(body)) {
    issues.push({ code: 'var_at_end', severity: 'warning' })
  }

  if (name !== undefined && name.length > 0) {
    if (!NAME_RE.test(name)) issues.push({ code: 'name_format', severity: 'error' })
    if (name.length > TEMPLATE_NAME_MAX) issues.push({ code: 'name_too_long', severity: 'error' })
  }

  const valid = !issues.some((i) => i.severity === 'error')
  return { variables, charCount, issues, valid }
}

/**
 * Suggest a Meta template name from a free-text label (lowercase, underscores).
 * Helps the admin produce a conforming `name` without memorizing the rule.
 */
export function suggestTemplateName(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip accents (acentos) so ES labels conform
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, TEMPLATE_NAME_MAX)
}

/** The Meta-facing category each template maps to (drives per-category guidance copy). */
export const CATEGORY_META_TYPE: Record<MessageTemplateCategory, 'utility' | 'marketing'> = {
  appointment_confirmation: 'utility',
  appointment_reminder: 'utility',
  human_handoff_notification: 'utility',
  review_request: 'marketing',
}
