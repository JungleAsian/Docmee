import { describe, it, expect } from 'vitest'
import {
  clinicStatusTone,
  clinicCardModel,
  sortClinicsForDirectory,
  defaultViewKey,
  type ClinicDirectoryStat,
} from './clinicDirectory'
import type { Clinic } from './types'

function clinic(overrides: Partial<Clinic>): Clinic {
  return {
    id: 'c-1',
    name: 'Clinic',
    slug: 'clinic',
    plan: 'starter',
    status: 'active',
    timezone: 'UTC',
    settings: {},
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    ...overrides,
  }
}

describe('clinicStatusTone', () => {
  it('maps active → active, suspended → paused, cancelled → cancelled', () => {
    expect(clinicStatusTone('active')).toBe('active')
    expect(clinicStatusTone('suspended')).toBe('paused')
    expect(clinicStatusTone('cancelled')).toBe('cancelled')
  })
})

describe('clinicCardModel', () => {
  const ctx = { activeClinicId: 'c-2', homeClinicId: 'c-1' }

  it('folds in the operational counts and flags the active/home clinic', () => {
    const stat: ClinicDirectoryStat = { clinicId: 'c-2', users: 12, openChats: 14, handoff: 3, urgent: 2 }
    const model = clinicCardModel(clinic({ id: 'c-2', status: 'active' }), stat, ctx)
    expect(model).toMatchObject({
      users: 12,
      openChats: 14,
      handoff: 3,
      urgent: 2,
      tone: 'active',
      botActive: true,
      isCurrent: true,
      isHome: false,
    })
  })

  it('defaults missing stats to zero', () => {
    const model = clinicCardModel(clinic({ id: 'c-1' }), undefined, ctx)
    expect(model).toMatchObject({ users: 0, openChats: 0, handoff: 0, urgent: 0, isHome: true, isCurrent: false })
  })

  it('a suspended clinic has the bot paused (humans only)', () => {
    const model = clinicCardModel(clinic({ id: 'c-9', status: 'suspended' }), undefined, ctx)
    expect(model.tone).toBe('paused')
    expect(model.botActive).toBe(false)
  })
})

describe('sortClinicsForDirectory', () => {
  it('orders active clinic first, then home, then the rest alphabetically', () => {
    const clinics = [
      clinic({ id: 'c-3', name: 'Zeta' }),
      clinic({ id: 'c-1', name: 'Home' }),
      clinic({ id: 'c-2', name: 'Active' }),
      clinic({ id: 'c-4', name: 'Alpha' }),
    ]
    const sorted = sortClinicsForDirectory(clinics, { activeClinicId: 'c-2', homeClinicId: 'c-1' })
    expect(sorted.map((c) => c.id)).toEqual(['c-2', 'c-1', 'c-4', 'c-3'])
  })

  it('does not mutate the input', () => {
    const clinics = [clinic({ id: 'c-2' }), clinic({ id: 'c-1' })]
    const before = clinics.map((c) => c.id)
    sortClinicsForDirectory(clinics, { activeClinicId: 'c-1', homeClinicId: 'c-1' })
    expect(clinics.map((c) => c.id)).toEqual(before)
  })
})

describe('defaultViewKey', () => {
  it('maps every role to its default inbox view', () => {
    expect(defaultViewKey('ia_studio_admin')).toBe('allClinics')
    expect(defaultViewKey('clinic_admin')).toBe('allChats')
    expect(defaultViewKey('doctor')).toBe('assignedToMe')
    expect(defaultViewKey('secretary')).toBe('unassigned')
  })
})
