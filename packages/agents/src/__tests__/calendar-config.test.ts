import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Clinic, Doctor, Sql } from '@docmee/db'
import { resolveCalendarConfig, calendarOpsFor } from '../calbot/calendar-config.js'

const h = vi.hoisted(() => ({
  findDoctor: vi.fn(),
  updateDoctor: vi.fn(),
  findClinic: vi.fn(),
  updateClinic: vi.fn(),
}))

vi.mock('@docmee/shared', () => ({
  decryptValue: (v: string) => v.replace(/^enc:/, ''),
  encryptValue: (v: string) => `enc:${v}`,
}))

vi.mock('@docmee/db', () => ({
  createDoctorsRepository: () => ({ findById: h.findDoctor, update: h.updateDoctor }),
  createClinicsRepository: () => ({ findById: h.findClinic, update: h.updateClinic }),
}))

const sql = {} as Sql

function makeClinic(over: Partial<Clinic> = {}): Clinic {
  return {
    id: 'clinic-1',
    name: 'Demo Clinic',
    settings: {},
    timezone: 'America/Guatemala',
    ...over,
  } as Clinic
}

function makeDoctor(over: Partial<Doctor> = {}): Doctor {
  return {
    id: 'doc-1',
    clinicId: 'clinic-1',
    name: 'Dra. García',
    googleCalendarId: null,
    googleCalendarAccessTokenEncrypted: null,
    googleCalendarRefreshTokenEncrypted: null,
    ...over,
  } as Doctor
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveCalendarConfig', () => {
  it('uses the doctor\'s own calendar when both tokens are present', async () => {
    h.findDoctor.mockResolvedValue(
      makeDoctor({
        googleCalendarId: 'doc-cal',
        googleCalendarAccessTokenEncrypted: 'enc:doc-access',
        googleCalendarRefreshTokenEncrypted: 'enc:doc-refresh',
      }),
    )
    const clinic = makeClinic({
      settings: { googleCalendar: { accessToken: 'enc:clinic-access', refreshToken: 'enc:clinic-refresh' } },
    })

    const resolved = await resolveCalendarConfig(sql, clinic, 'doc-1')

    expect(resolved).not.toBeNull()
    expect(resolved!.doctor?.id).toBe('doc-1')
    expect(resolved!.config).toMatchObject({
      accessToken: 'doc-access',
      refreshToken: 'doc-refresh',
      calendarId: 'doc-cal',
    })
  })

  it('falls back to the clinic calendar when the doctor has no tokens', async () => {
    h.findDoctor.mockResolvedValue(makeDoctor())
    const clinic = makeClinic({
      settings: {
        googleCalendar: { accessToken: 'enc:clinic-access', refreshToken: 'enc:clinic-refresh', calendarId: 'primary' },
      },
    })

    const resolved = await resolveCalendarConfig(sql, clinic, 'doc-1')

    expect(resolved).not.toBeNull()
    expect(resolved!.config).toMatchObject({ accessToken: 'clinic-access', refreshToken: 'clinic-refresh', calendarId: 'primary' })
  })

  it('returns null when neither the doctor nor the clinic has a calendar connected', async () => {
    h.findDoctor.mockResolvedValue(makeDoctor())
    const clinic = makeClinic({ settings: {} })

    const resolved = await resolveCalendarConfig(sql, clinic, 'doc-1')

    expect(resolved).toBeNull()
  })

  it('returns null when no doctorId is given and the clinic has no calendar', async () => {
    const clinic = makeClinic({ settings: {} })
    const resolved = await resolveCalendarConfig(sql, clinic, undefined)
    expect(resolved).toBeNull()
    expect(h.findDoctor).not.toHaveBeenCalled()
  })

  it('persists a refreshed token onto the doctor row when the doctor owns the calendar', async () => {
    h.findDoctor.mockResolvedValue(
      makeDoctor({
        googleCalendarAccessTokenEncrypted: 'enc:doc-access',
        googleCalendarRefreshTokenEncrypted: 'enc:doc-refresh',
      }),
    )
    const clinic = makeClinic()
    const resolved = await resolveCalendarConfig(sql, clinic, 'doc-1')

    await resolved!.config.onTokensRefreshed!({ accessToken: 'new-access', refreshToken: 'new-refresh' })

    expect(h.updateDoctor).toHaveBeenCalledWith('clinic-1', 'doc-1', {
      googleCalendarAccessTokenEncrypted: 'enc:new-access',
      googleCalendarRefreshTokenEncrypted: 'enc:new-refresh',
    })
    expect(h.updateClinic).not.toHaveBeenCalled()
  })

  it('persists a refreshed token onto the clinic settings when the clinic owns the calendar', async () => {
    h.findDoctor.mockResolvedValue(makeDoctor())
    const clinic = makeClinic({
      settings: { googleCalendar: { accessToken: 'enc:clinic-access', refreshToken: 'enc:clinic-refresh' } },
    })
    h.findClinic.mockResolvedValue(clinic)
    const resolved = await resolveCalendarConfig(sql, clinic, 'doc-1')

    await resolved!.config.onTokensRefreshed!({ accessToken: 'new-access', refreshToken: 'new-refresh' })

    expect(h.updateClinic).toHaveBeenCalledWith('clinic-1', {
      settings: expect.objectContaining({
        googleCalendar: expect.objectContaining({
          accessToken: 'enc:new-access',
          refreshToken: 'enc:new-refresh',
        }),
      }),
    })
    expect(h.updateDoctor).not.toHaveBeenCalled()
  })
})

describe('calendarOpsFor', () => {
  it('returns null when passed a null resolution', () => {
    expect(calendarOpsFor(null)).toBeNull()
  })
})
