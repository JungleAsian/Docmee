import { describe, it, expect } from 'vitest'
import {
  analyzeTemplate,
  extractVariables,
  suggestTemplateName,
  TEMPLATE_BODY_MAX,
  type TemplateIssueCode,
} from './templateGuidance'

function codes(body: string, name?: string): TemplateIssueCode[] {
  return analyzeTemplate(body, name).issues.map((i) => i.code)
}

describe('extractVariables', () => {
  it('finds numbered placeholders in order, keeping duplicates', () => {
    expect(extractVariables('Hola {{1}}, tu cita es {{2}}. Gracias {{1}}.')).toEqual([1, 2, 1])
  })

  it('tolerates inner whitespace and ignores non-numbered braces', () => {
    expect(extractVariables('A {{ 1 }} B {{name}} C')).toEqual([1])
  })

  it('returns empty for a plain body', () => {
    expect(extractVariables('No variables here')).toEqual([])
  })
})

describe('analyzeTemplate', () => {
  it('accepts a well-formed body with sequential variables', () => {
    const a = analyzeTemplate('Hola {{1}}, confirmamos tu cita el {{2}}.')
    expect(a.valid).toBe(true)
    expect(a.variables).toEqual([1, 2])
    expect(a.issues).toEqual([])
  })

  it('flags an empty body as an error', () => {
    expect(codes('   ')).toContain('body_empty')
    expect(analyzeTemplate('   ').valid).toBe(false)
  })

  it('flags a body over the Meta length cap', () => {
    expect(codes('x'.repeat(TEMPLATE_BODY_MAX + 1))).toContain('body_too_long')
  })

  it('flags non-sequential variables (gap or not starting at 1)', () => {
    expect(codes('Hola {{1}} y {{3}}')).toContain('vars_not_sequential')
    expect(codes('Hola {{2}}')).toContain('vars_not_sequential')
  })

  it('flags adjacent variables separated only by whitespace', () => {
    expect(codes('{{1}} {{2}}')).toContain('vars_adjacent')
    expect(codes('{{1}}{{2}}')).toContain('vars_adjacent')
    // Text between them clears the adjacency error.
    expect(codes('Hola {{1}}, gracias {{2}}')).not.toContain('vars_adjacent')
  })

  it('warns (not errors) on a body opening or closing on a variable', () => {
    const start = analyzeTemplate('{{1}} bienvenido a la clínica')
    expect(start.issues.map((i) => i.code)).toContain('var_at_start')
    expect(start.valid).toBe(true) // warning only

    const end = analyzeTemplate('Tu código es {{1}}')
    expect(end.issues.map((i) => i.code)).toContain('var_at_end')
    expect(end.valid).toBe(true)
  })

  it('validates the template name format when provided', () => {
    expect(codes('Hola {{1}}', 'Appointment Reminder!')).toContain('name_format')
    expect(codes('Hola {{1}}', 'appointment_reminder')).not.toContain('name_format')
    // An empty name is not validated (body-only edit path).
    expect(codes('Hola {{1}}', '')).not.toContain('name_format')
  })

  it('counts characters including trailing whitespace', () => {
    expect(analyzeTemplate('hola ').charCount).toBe(5)
  })
})

describe('suggestTemplateName', () => {
  it('produces a Meta-conforming name from a free-text label', () => {
    expect(suggestTemplateName('Confirmación de cita')).toBe('confirmacion_de_cita')
    expect(suggestTemplateName('  Review request!  ')).toBe('review_request')
    expect(suggestTemplateName('A/B test 2')).toBe('a_b_test_2')
  })
})
