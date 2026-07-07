// CRE-64: substitute {{variable}} placeholders in a quick-reply template when it is
// inserted into the composer. Only known keys are replaced; an unknown or empty
// variable is left intact so the operator can spot and fill it manually.
export type TemplateVars = Record<string, string | null | undefined>

/** Variables the inbox composer can resolve when inserting a quick reply. */
export const QUICK_REPLY_VARS = ['patient_name', 'date', 'time'] as const

export function applyTemplateVars(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key]
    return value != null && value !== '' ? String(value) : match
  })
}
