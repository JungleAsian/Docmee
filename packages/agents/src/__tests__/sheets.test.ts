import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  buildValueMatrix,
  buildCrmRowValues,
  CRM_HEADER,
  createGoogleCrmExporter,
  type ConversationExportRow,
  type CrmExportRow,
} from '../sheets/google-sheets-client.js'

describe('buildValueMatrix', () => {
  it('prepends a header row and renders booleans as yes/no', () => {
    const rows: ConversationExportRow[] = [
      { date: '2026-06-01', patientName: 'Ana', intent: 'booking', resolved: true, appointmentBooked: true },
      { date: '2026-06-02', patientName: '', intent: '', resolved: false, appointmentBooked: false },
    ]
    const matrix = buildValueMatrix(rows)
    expect(matrix[0]).toEqual(['Date', 'Patient name', 'Intent', 'Resolved', 'Appointment booked'])
    expect(matrix[1]).toEqual(['2026-06-01', 'Ana', 'booking', 'yes', 'yes'])
    expect(matrix[2]).toEqual(['2026-06-02', '', '', 'no', 'no'])
  })

  it('returns just the header for no rows', () => {
    expect(buildValueMatrix([])).toHaveLength(1)
  })
})

describe('buildCrmRowValues (Req 31)', () => {
  const appointment: CrmExportRow = {
    recordType: 'appointment',
    timestamp: '2026-06-19T10:00:00.000Z',
    clinicId: 'clinic-1',
    clinicName: 'Clínica Sol',
    patientName: 'Ana',
    phone: '5215555555555',
    source: 'whatsapp',
    doctorName: 'Dr. Pérez',
    specialty: 'Pediatría',
    reason: 'Consulta general',
    appointmentDate: '2026-06-25',
    appointmentTime: '09:30',
    status: 'confirmed',
    scheduled: true,
  }

  it('renders an appointment row in CRM_HEADER column order with scheduled=yes', () => {
    const row = buildCrmRowValues(appointment)
    expect(row).toHaveLength(CRM_HEADER.length)
    expect(row).toEqual([
      '2026-06-19T10:00:00.000Z',
      'appointment',
      'clinic-1',
      'Clínica Sol',
      'Ana',
      '5215555555555',
      'whatsapp',
      'Dr. Pérez',
      'Pediatría',
      'Consulta general',
      '2026-06-25',
      '09:30',
      'confirmed',
      'yes',
    ])
  })

  it('renders a contact row with empty appointment fields and scheduled=no', () => {
    const contact: CrmExportRow = {
      recordType: 'contact',
      timestamp: '2026-06-19T10:00:00.000Z',
      clinicId: 'clinic-1',
      clinicName: 'Clínica Sol',
      patientName: 'Bruno',
      phone: '5215511112222',
      source: 'instagram',
      doctorName: '',
      specialty: '',
      reason: '',
      appointmentDate: '',
      appointmentTime: '',
      status: 'new',
      scheduled: false,
    }
    const row = buildCrmRowValues(contact)
    expect(row[1]).toBe('contact')
    expect(row[6]).toBe('instagram')
    expect(row[12]).toBe('new')
    expect(row[13]).toBe('no')
    expect(row[10]).toBe('')
    expect(row[11]).toBe('')
  })
})

describe('createGoogleCrmExporter (LLM_STUB)', () => {
  const prev = process.env['LLM_STUB']
  beforeEach(() => {
    process.env['LLM_STUB'] = 'true'
  })
  afterEach(() => {
    if (prev === undefined) delete process.env['LLM_STUB']
    else process.env['LLM_STUB'] = prev
  })

  it('no-ops offline — appendRow never touches the network and resolves', async () => {
    const exporter = createGoogleCrmExporter({
      accessToken: 'a',
      refreshToken: 'r',
      spreadsheetId: 'sheet-1',
    })
    await expect(
      exporter.appendRow({
        recordType: 'appointment',
        timestamp: '2026-06-19T10:00:00.000Z',
        clinicId: 'clinic-1',
        clinicName: 'Clínica Sol',
        patientName: 'Ana',
        phone: '5215555555555',
        source: 'whatsapp',
        doctorName: 'Dr. Pérez',
        specialty: 'Pediatría',
        reason: 'Consulta',
        appointmentDate: '2026-06-25',
        appointmentTime: '09:30',
        status: 'confirmed',
        scheduled: true,
      }),
    ).resolves.toBeUndefined()
  })
})
