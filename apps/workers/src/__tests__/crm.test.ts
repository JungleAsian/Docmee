import { describe, it, expect, vi, beforeEach } from 'vitest'

// Req 31 (CRM / Google Sheets): the pure config resolution that decides whether a
// clinic exports to a Sheet, and which spreadsheet/tokens it uses. decryptValue
// and the exporter factory are mocked so this stays a fast, DB/Google-free test.

const h = vi.hoisted(() => ({
  createExporter: vi.fn(() => ({ appendRow: vi.fn() })),
  // Stored tokens are "enc:<plain>"; decrypt strips the prefix.
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
}))

vi.mock('@docmee/shared', () => ({ decryptValue: h.decrypt }))

vi.mock('@docmee/agents', () => ({
  createGoogleCrmExporter: h.createExporter,
}))

import { getCrmSettings, createClinicCrmExporter, patientPhone } from '../crm.js'

type Clinic = Parameters<typeof getCrmSettings>[0]

const baseClinic = (settings: Record<string, unknown>): Clinic =>
  ({ id: 'c1', name: 'Clínica', timezone: 'America/Mexico_City', settings }) as unknown as Clinic

const googleCalendar = { accessToken: 'enc:a', refreshToken: 'enc:r', expiryDate: 123 }

beforeEach(() => vi.clearAllMocks())

describe('getCrmSettings', () => {
  it('returns config when enabled with a spreadsheet id', () => {
    const clinic = baseClinic({ googleSheets: { enabled: true, spreadsheetId: 'sheet-1', sheetName: 'CRM' } })
    expect(getCrmSettings(clinic)).toEqual({ spreadsheetId: 'sheet-1', sheetName: 'CRM' })
  })

  it('omits a blank sheetName', () => {
    const clinic = baseClinic({ googleSheets: { enabled: true, spreadsheetId: 'sheet-1', sheetName: '' } })
    expect(getCrmSettings(clinic)).toEqual({ spreadsheetId: 'sheet-1' })
  })

  it('returns null when disabled', () => {
    const clinic = baseClinic({ googleSheets: { enabled: false, spreadsheetId: 'sheet-1' } })
    expect(getCrmSettings(clinic)).toBeNull()
  })

  it('returns null when enabled but no spreadsheet id', () => {
    const clinic = baseClinic({ googleSheets: { enabled: true, spreadsheetId: '' } })
    expect(getCrmSettings(clinic)).toBeNull()
  })

  it('returns null when unconfigured', () => {
    expect(getCrmSettings(baseClinic({}))).toBeNull()
  })
})

describe('createClinicCrmExporter', () => {
  it('returns null when CRM export is not enabled', () => {
    const clinic = baseClinic({ googleCalendar })
    expect(createClinicCrmExporter(clinic)).toBeNull()
    expect(h.createExporter).not.toHaveBeenCalled()
  })

  it('returns null when the clinic has no Google tokens', () => {
    const clinic = baseClinic({ googleSheets: { enabled: true, spreadsheetId: 'sheet-1' } })
    expect(createClinicCrmExporter(clinic)).toBeNull()
    expect(h.createExporter).not.toHaveBeenCalled()
  })

  it('builds an exporter with decrypted tokens, spreadsheet id and expiry', () => {
    const clinic = baseClinic({
      googleCalendar,
      googleSheets: { enabled: true, spreadsheetId: 'sheet-1', sheetName: 'CRM' },
    })
    const onRefresh = vi.fn()
    const exporter = createClinicCrmExporter(clinic, onRefresh)
    expect(exporter).not.toBeNull()
    expect(h.createExporter).toHaveBeenCalledWith({
      accessToken: 'a',
      refreshToken: 'r',
      spreadsheetId: 'sheet-1',
      sheetName: 'CRM',
      expiryDate: 123,
      onTokensRefreshed: onRefresh,
    })
  })

  it('returns null when tokens cannot be decrypted', () => {
    h.decrypt.mockImplementationOnce(() => {
      throw new Error('bad key')
    })
    const clinic = baseClinic({
      googleCalendar,
      googleSheets: { enabled: true, spreadsheetId: 'sheet-1' },
    })
    expect(createClinicCrmExporter(clinic)).toBeNull()
  })
})

describe('patientPhone', () => {
  const patient = (metadata: Record<string, unknown>) => ({ metadata }) as never
  it('prefers the captured intake phone', () => {
    expect(patientPhone(patient({ phone: '521999', contactHandle: 'psid' }), 'fb')).toBe('521999')
  })
  it('falls back to the contact handle', () => {
    expect(patientPhone(patient({ contactHandle: 'psid-1' }), 'fb')).toBe('psid-1')
  })
  it('uses the fallback when nothing is captured', () => {
    expect(patientPhone(patient({}), 'fallback')).toBe('fallback')
    expect(patientPhone(null, 'fallback')).toBe('fallback')
  })
})
