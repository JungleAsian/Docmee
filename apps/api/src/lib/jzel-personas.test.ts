import { describe, expect, it } from 'vitest'
import { personaForRole } from './jzel-personas.js'

describe('personaForRole', () => {
  it('identifies the built-in assistant as Docmee for every runtime role', () => {
    for (const role of ['secretary', 'doctor', 'clinic_admin', 'ia_studio_admin']) {
      const persona = personaForRole(role)
      expect(persona).toContain('Your name is Docmee')
      expect(persona).not.toMatch(/J\.zel|Jzel/i)
    }
  })
})
