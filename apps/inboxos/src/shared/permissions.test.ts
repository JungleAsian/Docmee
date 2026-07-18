import { describe, it, expect } from 'vitest'
import { can, rolesWith, capabilitiesOf, type Capability } from './permissions'
import type { PanelRole } from './types'

// These expectations mirror the API's requireRole(...) gating exactly. If a route's
// role list changes server-side, this table must change with it — that is the whole
// point of the panel-side RBAC mirror (Req 2).
const EXPECTED: Record<PanelRole, Capability[]> = {
  secretary: ['inbox', 'calendar', 'assistant'],
  doctor: ['inbox', 'calendar', 'assistant'],
  clinic_admin: ['inbox', 'calendar', 'assistant', 'metrics', 'analytics', 'qos', 'reports', 'studio'],
  ia_studio_admin: ['inbox', 'calendar', 'assistant', 'metrics', 'analytics', 'qos', 'reports', 'studio'],
}

describe('permissions.can', () => {
  it('matches the expected role/capability matrix', () => {
    for (const role of Object.keys(EXPECTED) as PanelRole[]) {
      for (const cap of EXPECTED[role]) {
        expect(can(role, cap)).toBe(true)
      }
    }
  })

  it('denies capabilities a role does not hold', () => {
    expect(can('secretary', 'metrics')).toBe(false)
    expect(can('secretary', 'studio')).toBe(false)
    expect(can('doctor', 'reports')).toBe(false)
    expect(can('doctor', 'studio')).toBe(false)
  })

  it('frontline inbox roles can use the inbox and assistant', () => {
    for (const role of ['secretary', 'doctor', 'clinic_admin'] as PanelRole[]) {
      expect(can(role, 'inbox')).toBe(true)
      expect(can(role, 'assistant')).toBe(true)
    }
  })

  it('treats a missing role as fully unauthorized', () => {
    expect(can(undefined, 'inbox')).toBe(false)
    expect(can(null, 'metrics')).toBe(false)
  })
})

describe('permissions.rolesWith', () => {
  it('lists the roles allowed per capability (matches API gates)', () => {
    expect(rolesWith('inbox').sort()).toEqual(['clinic_admin', 'doctor', 'ia_studio_admin', 'secretary'])
    expect(rolesWith('calendar').sort()).toEqual(['clinic_admin', 'doctor', 'ia_studio_admin', 'secretary'])
    expect(rolesWith('assistant').sort()).toEqual(['clinic_admin', 'doctor', 'ia_studio_admin', 'secretary'])
    expect(rolesWith('metrics').sort()).toEqual(['clinic_admin', 'ia_studio_admin'])
    expect(rolesWith('analytics').sort()).toEqual(['clinic_admin', 'ia_studio_admin'])
    expect(rolesWith('qos').sort()).toEqual(['clinic_admin', 'ia_studio_admin'])
    expect(rolesWith('reports').sort()).toEqual(['clinic_admin', 'ia_studio_admin'])
    expect(rolesWith('studio').sort()).toEqual(['clinic_admin', 'ia_studio_admin'])
  })
})

describe('permissions.capabilitiesOf', () => {
  it('returns the full capability set per role', () => {
    for (const role of Object.keys(EXPECTED) as PanelRole[]) {
      expect([...capabilitiesOf(role)].sort()).toEqual([...EXPECTED[role]].sort())
    }
  })
})
