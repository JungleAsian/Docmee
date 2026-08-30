import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findWorkflow: vi.fn(),
  findPatient: vi.fn(),
  claimRun: vi.fn(),
  findRun: vi.fn(),
  setRunStatus: vi.fn(),
  claimEffect: vi.fn(),
  findEffect: vi.fn(),
  succeedEffect: vi.fn(),
  markEffectUncertain: vi.fn(),
  runWorkflow: vi.fn(),
  invokeEffect: vi.fn(),
  findClinic: vi.fn(),
  findDoctor: vi.fn(),
  listServices: vi.fn(),
  findAppointment: vi.fn(),
  saveWithinCapacity: vi.fn(),
  updateAppointment: vi.fn(),
  listSlots: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  listAccounts: vi.fn(),
  listContacts: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppInteractiveList: vi.fn(),
  findTemplate: vi.fn(),
  createMessage: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/agents', () => ({
  validateWorkflowDefinition: () => [],
  runWorkflow: h.runWorkflow,
  createGoogleCalendarOps: () => ({ listSlots: h.listSlots, createEvent: h.createCalendarEvent, updateEvent: h.updateCalendarEvent }),
  WORKFLOW_CAPTURE_CONTEXT_KEY: 'capture',
  WORKFLOW_MENU_CONTEXT_KEY: 'menu',
  WORKFLOW_SLOT_MENU_CONTEXT_KEY: 'slots',
  SLOT_MENU_MORE_OPTION_ID: 'more',
  parseMenuOptions: (config: Record<string, unknown> | undefined) => config?.['options'] ?? [],
}))

vi.mock('@docmee/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@docmee/shared')>()),
  decryptValue: (value: string) => value,
  encryptValue: (value: string) => value,
}))
vi.mock('@docmee/llm', () => ({ chatComplete: vi.fn(), defaultChatModel: () => 'test' }))
vi.mock('@docmee/channels', () => ({
  sendWhatsAppText: h.sendWhatsAppText,
  sendWhatsAppInteractiveButtons: vi.fn(),
  sendWhatsAppInteractiveList: h.sendWhatsAppInteractiveList,
}))
vi.mock('../follow-up.js', () => ({ scheduleNoResponseFollowUp: vi.fn() }))
vi.mock('../bot-handoff.js', () => ({ pauseBotForHandoff: vi.fn() }))
vi.mock('@docmee/queue', () => ({ createQueue: () => ({ add: vi.fn() }) }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createWorkflowsRepository: () => ({ findById: h.findWorkflow }),
  createPatientsRepository: () => ({ findById: h.findPatient, listContacts: h.listContacts }),
  createWorkflowExecutionsRepository: () => ({
    claimRun: h.claimRun,
    findRun: h.findRun,
    setRunStatus: h.setRunStatus,
    claimEffect: h.claimEffect,
    findEffect: h.findEffect,
    succeedEffect: h.succeedEffect,
    markEffectUncertain: h.markEffectUncertain,
  }),
  createWorkflowApprovalsRepository: () => ({ claimResume: vi.fn(), markResumed: vi.fn(), markFailed: vi.fn() }),
  createClinicsRepository: () => ({ findById: h.findClinic, update: vi.fn() }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createConversationsRepository: () => ({}),
  createDoctorsRepository: () => ({ findById: h.findDoctor, listByClinic: vi.fn(), update: vi.fn() }),
  createDoctorServicesRepository: () => ({}),
  createAppointmentsRepository: () => ({
    listServices: h.listServices,
    findById: h.findAppointment,
    saveWithinCapacity: h.saveWithinCapacity,
    update: h.updateAppointment,
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
  createMessageTemplatesRepository: () => ({ findApprovedByCategory: h.findTemplate }),
  createNotificationsRepository: () => ({}),
  createKnowledgeRepository: () => ({}),
}))

import { processWorkflowRunJob } from '../workflow-runner.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const WORKFLOW = '22222222-2222-2222-2222-222222222222'
const PATIENT = '33333333-3333-3333-3333-333333333333'
const job = {
  id: 'job-1',
  data: {
    clinicId: CLINIC,
    workflowId: WORKFLOW,
    trigger: { type: 'message_keyword', sourceEventId: 'wamid.1', patientId: PATIENT },
  },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.findWorkflow.mockResolvedValue({ id: WORKFLOW, name: 'Booking', status: 'active', nodes: [], edges: [] })
  h.findPatient.mockResolvedValue({ id: PATIENT, automationMode: 'automated', metadata: {} })
  h.claimRun.mockResolvedValue({ id: 'run-1' })
  h.setRunStatus.mockResolvedValue(undefined)
  h.claimEffect.mockResolvedValue({ id: 'effect-1' })
  h.runWorkflow.mockResolvedValue([{ status: 'completed' }])
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinic', timezone: 'UTC', settings: {} })
  h.findDoctor.mockResolvedValue({
    id: '44444444-4444-4444-8444-444444444444', name: 'Dr Test', availableDays: {},
    googleCalendarAccessTokenEncrypted: 'access', googleCalendarRefreshTokenEncrypted: 'refresh',
    googleCalendarId: 'primary',
  })
  h.listServices.mockResolvedValue([])
  h.findAppointment.mockResolvedValue({ id: 'appt-existing', googleEventId: null })
  h.listSlots.mockResolvedValue([{ start: '2026-09-15T09:00:00', end: '2026-09-15T09:30:00' }])
  h.saveWithinCapacity.mockResolvedValue({ ok: true, appointment: { id: 'appt-1' }, clashCount: 0 })
  h.updateAppointment.mockResolvedValue({ id: 'appt-1' })
  h.createCalendarEvent.mockResolvedValue('event-1')
  h.updateCalendarEvent.mockResolvedValue(undefined)
  h.listAccounts.mockResolvedValue([{ channel: 'whatsapp', status: 'active', accountId: 'phone-1', accessTokenEnc: 'token' }])
  h.listContacts.mockResolvedValue([{ channel: 'whatsapp', contactHandle: '15551234567', isPrimary: true }])
  h.sendWhatsAppText.mockResolvedValue('wamid.sent')
  h.sendWhatsAppInteractiveList.mockResolvedValue('wamid.menu')
  h.findTemplate.mockResolvedValue({ body: 'Approved reminder' })
  h.createMessage.mockResolvedValue({ id: 'message-1' })
})

describe('processWorkflowRunJob automation ownership', () => {
  it('does not claim or execute a workflow for a human-only patient', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, automationMode: 'human_only', metadata: {} })

    await processWorkflowRunJob(job)

    expect(h.claimRun).not.toHaveBeenCalled()
    expect(h.runWorkflow).not.toHaveBeenCalled()
  })

  it('re-checks human-only ownership before claiming each workflow side effect', async () => {
    h.findPatient
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'human_only', metadata: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.runSideEffect({ id: 'action-1', type: 'send_message', config: {} }, ctx, h.invokeEffect)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.claimEffect).not.toHaveBeenCalled()
    expect(h.invokeEffect).not.toHaveBeenCalled()
  })

  it('re-checks human-only ownership immediately before the provider send', async () => {
    h.findPatient
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'human_only', metadata: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.sendMessage('This must not be sent', ctx)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.createMessage).not.toHaveBeenCalled()
    expect(h.setRunStatus).toHaveBeenLastCalledWith('run-1', 'completed', expect.objectContaining({
      reason: 'patient_human_only',
      terminalState: 'suppressed',
    }))
  })

  it('re-checks human-only ownership immediately before an approved template send', async () => {
    h.findPatient
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'human_only', metadata: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.sendTemplate('appointment_reminder', ctx)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.createMessage).not.toHaveBeenCalled()
  })

  it.each(['interactive menu', 'slot menu'])('re-checks human-only ownership immediately before an %s provider send', async (label) => {
    h.findPatient
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'automated', metadata: {} })
      .mockResolvedValueOnce({ id: PATIENT, automationMode: 'human_only', metadata: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      if (label === 'interactive menu') {
        await exec.sendInteractiveMenu({ id: 'menu-1', type: 'interactive_menu', config: { message: 'Choose', options: [{ optionId: 'one', title: 'One' }] } }, ctx, 0)
      } else {
        await exec.sendSlotMenu({ id: 'slots-1', type: 'slot_menu', config: { message: 'Choose a date' } }, { ...ctx, available_slots: [{ start: '2027-09-15T09:00:00', end: '2027-09-15T09:30:00' }] }, 0)
      }
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.sendWhatsAppInteractiveList).not.toHaveBeenCalled()
    expect(h.createMessage).not.toHaveBeenCalled()
  })

  it('creates workflow bookings through the atomic capacity operation with overbooking disabled', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'preferred_date',
          timeField: 'preferred_time',
        },
      }, { ...ctx, preferred_date: '2026-09-15', preferred_time: '09:00' })
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'create', capacity: 1, allowOverbooking: false,
    }))
  })

  it('still sends the workflow confirmation when Google Calendar create stalls after saving the booking', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.createCalendarEvent.mockImplementation(() => new Promise(() => undefined))
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const bookingCtx = { ...ctx, preferred_date: '2026-09-15', preferred_time: '09:00' }
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'preferred_date',
          timeField: 'preferred_time',
        },
      }, bookingCtx)
      await exec.sendMessage('Appointment booked successfully.', bookingCtx)
      return [{ status: 'completed' }]
    })

    try {
      const run = processWorkflowRunJob(job)
      await vi.advanceTimersByTimeAsync(8_000)
      await run
    } finally {
      errorSpy.mockRestore()
      vi.useRealTimers()
    }

    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'create', capacity: 1, allowOverbooking: false,
    }))
    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, 'appt-1', expect.objectContaining({
      status: 'confirmed',
      calendarSyncPending: true,
      calendarSyncError: 'Google Calendar event creation timed out after 8000ms',
    }))
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'Appointment booked successfully.',
    )
  })

  it('books with the slot menu time fallback when the booking node time field is misconfigured', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const bookingCtx = {
        ...ctx,
        selected_date: '2026-09-15',
        selected_booking_key: '09:00',
      }
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'selected_date',
          timeField: 'selected_time',
        },
      }, bookingCtx)
      await exec.sendMessage('Appointment booked successfully.', bookingCtx)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'create',
      startTime: '2026-09-15T09:00:00.000Z',
      endTime: '2026-09-15T09:30:00.000Z',
    }))
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'Appointment booked successfully.',
    )
  })

  it('reschedules workflow bookings through the atomic capacity operation', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          mode: 'reschedule',
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'preferred_date',
          timeField: 'preferred_time',
          appointmentIdField: 'appointment_id',
        },
      }, {
        ...ctx,
        appointment_id: 'appt-existing',
        preferred_date: '2026-09-15',
        preferred_time: '09:00',
      })
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'reschedule',
      appointmentId: 'appt-existing',
      startTime: '2026-09-15T09:00:00.000Z',
      endTime: '2026-09-15T09:30:00.000Z',
    }))
    expect(h.updateAppointment).not.toHaveBeenCalledWith(
      CLINIC,
      'appt-existing',
      expect.objectContaining({ startTime: expect.any(String) }),
    )
  })

  it.each(['create', 'reschedule'])('rejects a past workflow %s before capacity or calendar operations', async (mode) => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-15T10:00:00.000Z'))
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          ...(mode === 'reschedule' ? { mode: 'reschedule', appointmentIdField: 'appointment_id' } : {}),
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'preferred_date',
          timeField: 'preferred_time',
        },
      }, {
        ...ctx,
        appointment_id: 'appt-existing',
        preferred_date: '2026-09-15',
        preferred_time: '09:00',
      })
      return [{ status: 'completed' }]
    })

    try {
      await expect(processWorkflowRunJob(job)).rejects.toThrow('must be in the future')
    } finally {
      nowSpy.mockRestore()
    }

    expect(h.saveWithinCapacity).not.toHaveBeenCalled()
    expect(h.listSlots).not.toHaveBeenCalled()
    expect(h.createCalendarEvent).not.toHaveBeenCalled()
  })

  it('stores a clinic-local workflow booking as the correct UTC instant', async () => {
    h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinic', timezone: 'America/Guatemala', settings: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'create_booking',
        config: {
          doctorId: '44444444-4444-4444-8444-444444444444',
          dateField: 'preferred_date',
          timeField: 'preferred_time',
        },
      }, { ...ctx, preferred_date: '2026-09-15', preferred_time: '09:00' })
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({
      startTime: '2026-09-15T15:00:00.000Z',
      endTime: '2026-09-15T15:30:00.000Z',
    }))
  })
})
