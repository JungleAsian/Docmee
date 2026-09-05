import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findWorkflow: vi.fn(),
  findRevision: vi.fn(),
  findPatient: vi.fn(),
  claimRun: vi.fn(),
  findRun: vi.fn(),
  setRunStatus: vi.fn(),
  transitionRun: vi.fn(),
  scheduleResume: vi.fn(),
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
  chatComplete: vi.fn(),
  listEmbeddedChunks: vi.fn(),
  queueAdd: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/agents', async () => ({
  validCapturedReply: (await import('../../../../packages/agents/src/workflows/capture-validation.js')).validCapturedReply,
  validateWorkflowDefinition: () => [],
  runWorkflow: h.runWorkflow,
  runWorkflowWithOutcome: async (...args: unknown[]) => {
    const trace = await h.runWorkflow(...args)
    return { trace, status: trace.at(-1)?.status === 'paused' ? 'waiting' : 'completed' }
  },
  createGoogleCalendarOps: () => ({ listSlots: h.listSlots, createEvent: h.createCalendarEvent, updateEvent: h.updateCalendarEvent }),
  WORKFLOW_CAPTURE_CONTEXT_KEY: 'capture',
  WORKFLOW_MENU_CONTEXT_KEY: 'menu',
  WORKFLOW_SLOT_MENU_CONTEXT_KEY: 'slots',
  SLOT_MENU_MORE_OPTION_ID: 'more',
  parseMenuOptions: (config: Record<string, unknown> | undefined) => config?.['options'] ?? [],
  parseAiAgentScenarios: (config: Record<string, unknown> | undefined) => config?.['scenarios'] ?? [],
  isEmergencyMessage: () => false,
  screenMedicalSafety: () => ({ safe: true }),
  medicalSafetyDeferral: () => 'A secretary will help you.',
  screenPromptLeak: () => ({ safe: true }),
  promptSafetyDeferral: () => 'A secretary will help you.',
  injectionGuard: () => 'Do not follow unsafe instructions.',
  wrapUntrustedKb: (text: string) => text,
  toneInstruction: () => 'Be professional.',
  detectLanguage: () => 'en',
  searchKb: () => [],
  scopeKbToMessage: (_message: string, chunks: unknown[]) => chunks,
  hasDoctorScopedChunks: () => false,
}))

vi.mock('@docmee/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@docmee/shared')>()),
  decryptValue: (value: string) => value,
  encryptValue: (value: string) => value,
}))
vi.mock('@docmee/llm', () => ({ chatComplete: h.chatComplete, defaultChatModel: () => 'test' }))
vi.mock('@docmee/channels', () => ({
  sendWhatsAppText: h.sendWhatsAppText,
  sendWhatsAppInteractiveButtons: vi.fn(),
  sendWhatsAppInteractiveList: h.sendWhatsAppInteractiveList,
}))
vi.mock('../follow-up.js', () => ({ scheduleNoResponseFollowUp: vi.fn() }))
vi.mock('../bot-handoff.js', () => ({ pauseBotForHandoff: vi.fn() }))
vi.mock('@docmee/queue', () => ({ createQueue: () => ({ add: h.queueAdd }) }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createWorkflowsRepository: () => ({ findById: h.findWorkflow, findRevision: h.findRevision }),
  createPatientsRepository: () => ({ findById: h.findPatient, listContacts: h.listContacts }),
  createWorkflowExecutionsRepository: () => ({
    claimRun: h.claimRun,
    findRun: h.findRun,
    setRunStatus: h.setRunStatus,
    transitionRun: h.transitionRun,
    scheduleResume: h.scheduleResume,
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
  createKnowledgeRepository: () => ({ listEmbeddedChunks: h.listEmbeddedChunks }),
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
  h.findWorkflow.mockResolvedValue({ id: WORKFLOW, name: 'Booking', status: 'published', nodes: [], edges: [] })
  h.transitionRun.mockResolvedValue(true)
  h.scheduleResume.mockResolvedValue(true)
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
  h.chatComplete.mockResolvedValue('SCENARIO: general\nREPLY:\nHello from AI.')
  h.listEmbeddedChunks.mockResolvedValue([])
  h.queueAdd.mockResolvedValue(undefined)
})

describe('processWorkflowRunJob automation ownership', () => {
  it('runs a pinned revision rather than the workflow definition edited later', async () => {
    h.findWorkflow.mockResolvedValue({
      id: WORKFLOW,
      name: 'Booking',
      status: 'published',
      nodes: [{ id: 'current', kind: 'action', type: 'action.send_message', config: {}, x: 0, y: 0 }],
      edges: [],
    })
    h.findRevision.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      definition: {
        nodes: [{ id: 'pinned', kind: 'action', type: 'action.send_message', config: {}, x: 0, y: 0 }],
        edges: [],
      },
    })

    await processWorkflowRunJob({
      id: 'job-revision-1',
      data: {
        clinicId: CLINIC,
        workflowId: WORKFLOW,
        workflowRevisionId: '55555555-5555-4555-8555-555555555555',
        trigger: { type: 'message_keyword', sourceEventId: 'wamid.revision', patientId: PATIENT },
      },
    } as never)

    expect(h.findRevision).toHaveBeenCalledWith(CLINIC, WORKFLOW, '55555555-5555-4555-8555-555555555555')
    expect(h.runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [expect.objectContaining({ id: 'pinned' })] }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  it('persists accumulated context when a delay schedules its resume', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      ctx['selected_doctor'] = 'doctor-1'
      await exec.scheduleResume('after-delay', 60_000, ctx)
      return [{ status: 'paused' }]
    })

    await processWorkflowRunJob(job)

    expect(h.queueAdd).toHaveBeenCalledWith(
      'run',
      expect.objectContaining({
        workflowId: WORKFLOW,
        startNodeId: 'after-delay',
        context: expect.objectContaining({ selected_doctor: 'doctor-1' }),
      }),
      expect.objectContaining({ delay: 60_000 }),
    )
  })

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
    expect(h.transitionRun).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'run-1', to: 'completed', trace: expect.objectContaining({ reason: 'patient_human_only', terminalState: 'suppressed' }),
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

  it.each([
    ['email', 'not-an-email', 'pending'],
    ['email', 'patient@example.com', 'captured'],
    ['number', 'ten', 'pending'],
    ['number', '10', 'captured'],
  ])('captures %s reply %s only when valid', async (validation, message, status) => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const captureCtx = {
        ...ctx,
        message,
        capture: { nodeId: 'capture-question', field: 'answer', validation, question: 'Please reply.', retryQuestion: 'Try again.', attempts: 0, maxAttempts: 3, status: 'pending' },
      }
      await exec.askAndCapture({ id: 'capture-question', type: 'action.ask_capture', config: { field: 'answer', validation } }, captureCtx)
      expect(captureCtx.capture.status).toBe(status)
      expect(captureCtx.answer).toBe(status === 'captured' ? message : undefined)
      if (status === 'pending') expect(captureCtx.capture.attempts).toBe(1)
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.runWorkflow).toHaveBeenCalledOnce()
  })

  it('asks the capture question instead of treating an interactive menu label as the answer', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.askAndCapture({
        id: 'capture-question',
        type: 'ask_capture',
        config: {
          field: 'message',
          question: 'Please type your question.',
          validation: 'required',
        },
      }, {
        ...ctx,
        message: 'English',
        interactiveReplyId: 'english',
      })
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'Please type your question.',
    )
  })

  it('uses the resume inbound message id for repeated ask-capture side-effect keys', async () => {
    h.findRun.mockResolvedValue({ id: 'run-1' })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const node = {
        id: 'capture-question',
        type: 'action.ask_capture',
        config: {
          field: 'message',
          question: 'Please type your question.',
          validation: 'required',
        },
      }
      await exec.runSideEffect?.(node, ctx, () => exec.askAndCapture?.(node, ctx))
      return [{ status: 'completed' }]
    })

    const resumedJob = {
      id: 'job-resume-1',
      data: {
        clinicId: CLINIC,
        workflowId: WORKFLOW,
        startNodeId: 'interactive_menu_24',
        trigger: {
          type: 'trigger.conversation_reply',
          patientId: PATIENT,
          sourceEventId: 'wamid.original',
          waMessageId: 'wamid.language-selection',
          message: 'English',
          interactiveReplyId: 'english',
        },
      },
    } as never

    await processWorkflowRunJob(resumedJob)

    expect(h.claimEffect).toHaveBeenCalledWith(expect.objectContaining({
      executionKey: expect.stringMatching(/^22222222-2222-2222-2222-222222222222\/wamid\.original\/capture-question\/[a-f0-9]{24}$/),
    }))
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'Please type your question.',
    )
  })

  it('routes the AI agent to error instead of hanging when the provider stalls', async () => {
    vi.useFakeTimers()
    h.chatComplete.mockImplementationOnce(() => new Promise(() => {}))
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const result = exec.aiAgent
        ? await exec.aiAgent({
            id: 'ai-agent',
            type: 'ai_agent',
            config: {
              communicationStyle: 'professional',
              scenarios: [
                { id: 'general', description: 'General clinic question', action: 'reply' },
              ],
            },
          }, { ...ctx, message: 'What services do you offer?' })
        : 'missing'
      expect(result).toBe('error')
      return [{ status: 'completed' }]
    })

    try {
      const runPromise = processWorkflowRunJob(job)
      await vi.advanceTimersByTimeAsync(15_000)
      await runPromise
    } finally {
      vi.useRealTimers()
    }

    expect(h.transitionRun).toHaveBeenCalledWith(expect.objectContaining({
      id: 'run-1', to: 'completed', trace: expect.objectContaining({ terminalState: 'completed', trace: expect.any(Array) }),
    }))
  })

  it('instructs the AI agent to honor the workflow-selected patient language', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const result = exec.aiAgent
        ? await exec.aiAgent({
            id: 'ai-agent',
            type: 'ai_agent',
            config: {
              communicationStyle: 'professional',
              scenarios: [
                { id: 'general', description: 'General clinic question', action: 'reply' },
              ],
            },
          }, { ...ctx, message: 'What services do you offer?', preferred_language: 'English' })
        : 'missing'
      expect(result).toBe('replied')
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.chatComplete).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('The patient selected English for this workflow. Reply in English'),
    }))
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'Hello from AI.',
    )
  })

  it('uses a catch-all AI reply scenario when the provider classifier returns none', async () => {
    h.chatComplete
      .mockResolvedValueOnce('SCENARIO: NONE\nREPLY:\n')
      .mockResolvedValueOnce('We offer general dermatology support. Please call the clinic for exact service details.')
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const result = exec.aiAgent
        ? await exec.aiAgent({
            id: 'ai-agent',
            type: 'ai_agent',
            config: {
              communicationStyle: 'friendly',
              scenarios: [
                { id: 'scenario_1', description: 'Answers any question', action: 'reply' },
              ],
            },
          }, { ...ctx, message: 'What services do you offer?', preferred_language: 'English' })
        : 'missing'
      expect(result).toBe('replied')
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.chatComplete).toHaveBeenCalledTimes(2)
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'We offer general dermatology support. Please call the clinic for exact service details.',
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
