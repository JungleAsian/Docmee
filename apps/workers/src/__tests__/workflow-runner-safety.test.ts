import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findWorkflow: vi.fn(),
  findRevision: vi.fn(),
  findPatient: vi.fn(),
  updatePatient: vi.fn(),
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
  deleteCalendarEvent: vi.fn(),
  listPatientAppointments: vi.fn(),
  addAppointmentEvent: vi.fn(),
  listAccounts: vi.fn(),
  listContacts: vi.fn(),
  sendWhatsAppText: vi.fn(),
  sendWhatsAppInteractiveList: vi.fn(),
  findTemplate: vi.fn(),
  createMessage: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  chatComplete: vi.fn(),
  searchChunks: vi.fn(),
  recordLearning: vi.fn(),
  learningSettings: vi.fn(),
  reviewLearning: vi.fn(),
  sourcesCurrent: vi.fn(),
  scopedConsistency: vi.fn(),
  isEmergencyMessage: vi.fn(),
  queueAdd: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/agents', async () => ({
  resolveAiAgentSettings: (await import('../../../../packages/agents/src/workflows/ai-agent-settings.js')).resolveAiAgentSettings,
  validCapturedReply: (await import('../../../../packages/agents/src/workflows/capture-validation.js')).validCapturedReply,
  validateWorkflowDefinition: () => [],
  runWorkflow: h.runWorkflow,
  runWorkflowWithOutcome: async (...args: unknown[]) => {
    const trace = await h.runWorkflow(...args)
    return { trace, status: trace.at(-1)?.status === 'paused' ? 'waiting' : 'completed' }
  },
  createGoogleCalendarOps: () => ({ listSlots: h.listSlots, createEvent: h.createCalendarEvent, updateEvent: h.updateCalendarEvent, deleteEvent: h.deleteCalendarEvent }),
  formatCalendarBooking: (details: { serviceName?: string | null; patientName?: string | null; patientPhone?: string | null; patientEmail?: string | null; reason?: string | null }) => ({
    title: `${details.serviceName?.trim() || 'Clinic appointment'} - ${details.patientName?.trim() || 'Patient'}`,
    description: `Details:\nPatient phone: ${details.patientPhone?.trim() || 'Not provided'}\nPatient email: ${details.patientEmail?.trim() || 'Not provided'}\nReason for visit: ${details.reason?.trim() || 'Not provided'}`,
  }),
  WORKFLOW_CAPTURE_CONTEXT_KEY: 'capture',
  WORKFLOW_MENU_CONTEXT_KEY: 'menu',
  WORKFLOW_SLOT_MENU_CONTEXT_KEY: 'slots',
  SLOT_MENU_MORE_OPTION_ID: 'more',
  parseMenuOptions: (config: Record<string, unknown> | undefined) => config?.['options'] ?? [],
  parseAiAgentScenarios: (config: Record<string, unknown> | undefined) => config?.['scenarios'] ?? [],
  isEmergencyMessage: h.isEmergencyMessage,
  screenMedicalSafety: () => ({ safe: true }),
  medicalSafetyDeferral: () => 'A secretary will help you.',
  screenPromptLeak: () => ({ safe: true }),
  promptSafetyDeferral: () => 'A secretary will help you.',
  injectionGuard: () => 'Do not follow unsafe instructions.',
  wrapUntrustedKb: (text: string) => text,
  toneInstruction: () => 'Be professional.',
  detectLanguage: () => 'en',
  searchKb: () => [],
  rankKeywordChunks: () => [],
  rerankHybridChunks: (await import('../../../../packages/agents/src/botbase/kb-retriever.js')).rerankHybridChunks,
  expandKbQuery: (query: string) => query,
  assessKbAnswer: (await import('../../../../packages/agents/src/botbase/kb-learning.js')).assessKbAnswer,
  knowledgeHandoffNotice: () => 'A secretary will help you.',
  isLikelyQuestion: () => false,
  scopeKbToMessage: (_message: string, chunks: unknown[]) => chunks,
  hasDoctorScopedChunks: () => false,
}))

vi.mock('@docmee/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@docmee/shared')>()),
  decryptValue: (value: string) => value,
  encryptValue: (value: string) => value,
}))
vi.mock('@docmee/llm', () => ({
  chatComplete: h.chatComplete,
  defaultChatModel: () => 'test',
  claudeComplete: vi.fn(),
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
  embed: vi.fn(async () => [0.1, 0.2, 0.3]),
}))
vi.mock('@docmee/channels', () => ({
  sendWhatsAppText: h.sendWhatsAppText,
  sendWhatsAppInteractiveButtons: vi.fn(),
  sendWhatsAppInteractiveList: h.sendWhatsAppInteractiveList,
}))
vi.mock('../follow-up.js', () => ({ scheduleNoResponseFollowUp: vi.fn() }))
vi.mock('../bot-handoff.js', () => ({ pauseBotForHandoff: vi.fn() }))
vi.mock('@docmee/queue', () => ({ createQueue: () => ({ add: h.queueAdd }), kbEmbedQueue: { add: h.queueAdd } }))

vi.mock('@docmee/db', async () => ({
  ...(await import('../../../../packages/db/src/repositories/knowledge-learning-evidence.js')),
  createServiceDbClient: () => ({ end: h.end }),
  createWorkflowsRepository: () => ({ findById: h.findWorkflow, findRevision: h.findRevision }),
  createPatientsRepository: () => ({ findById: h.findPatient, update: h.updatePatient, listContacts: h.listContacts }),
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
  createConversationsRepository: () => ({ findById: h.findConversation, update: h.updateConversation }),
  createDoctorsRepository: () => ({ findById: h.findDoctor, listByClinic: vi.fn(), update: vi.fn() }),
  createDoctorServicesRepository: () => ({ listServicesForDoctor: vi.fn(async () => []) }),
  createAppointmentsRepository: () => ({
    listServices: h.listServices,
    listByPatient: h.listPatientAppointments,
    findById: h.findAppointment,
    saveWithinCapacity: h.saveWithinCapacity,
    update: h.updateAppointment,
    addEvent: h.addAppointmentEvent,
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
  createMessageTemplatesRepository: () => ({ findApprovedByCategory: h.findTemplate }),
  createNotificationsRepository: () => ({ create: vi.fn() }),
  createKnowledgeRepository: () => ({ searchChunks: h.searchChunks, getClinicRetrievalRevision: async () => 1, markDocumentIndexFailed: vi.fn() }),
  createKnowledgeLearningRepository: () => ({ recordAttempt: h.recordLearning, settings: h.learningSettings, review: h.reviewLearning, sourcesCurrent: h.sourcesCurrent, scopedConsistency: h.scopedConsistency }),
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
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 10))
  h.findWorkflow.mockResolvedValue({ id: WORKFLOW, name: 'Booking', status: 'published', nodes: [], edges: [] })
  h.transitionRun.mockResolvedValue(true)
  h.scheduleResume.mockResolvedValue(true)
  h.findPatient.mockResolvedValue({ id: PATIENT, automationMode: 'automated', fullName: 'Patient Test', phoneE164: '+15551234567', email: 'patient@example.com', metadata: {} })
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
  h.findAppointment.mockResolvedValue({
    id: 'appt-existing', patientId: PATIENT, doctorId: '44444444-4444-4444-8444-444444444444', serviceId: null,
    status: 'confirmed', startTime: '2026-09-14T09:00:00.000Z', endTime: '2026-09-14T09:30:00.000Z', googleEventId: null,
  })
  h.listPatientAppointments.mockResolvedValue([])
  h.listSlots.mockResolvedValue([{ start: '2026-09-15T09:00:00', end: '2026-09-15T09:30:00' }])
  h.saveWithinCapacity.mockResolvedValue({ ok: true, appointment: { id: 'appt-1' }, clashCount: 0 })
  h.updateAppointment.mockResolvedValue({ id: 'appt-1' })
  h.createCalendarEvent.mockResolvedValue('event-1')
  h.updateCalendarEvent.mockResolvedValue(undefined)
  h.deleteCalendarEvent.mockResolvedValue(undefined)
  h.addAppointmentEvent.mockResolvedValue({ id: 'event-cancelled' })
  h.listAccounts.mockResolvedValue([{ channel: 'whatsapp', status: 'active', accountId: 'phone-1', accessTokenEnc: 'token' }])
  h.listContacts.mockResolvedValue([{ channel: 'whatsapp', contactHandle: '15551234567', isPrimary: true }])
  h.sendWhatsAppText.mockResolvedValue('wamid.sent')
  h.sendWhatsAppInteractiveList.mockResolvedValue('wamid.menu')
  h.findTemplate.mockResolvedValue({ body: 'Approved reminder' })
  h.createMessage.mockResolvedValue({ id: 'message-1' })
  h.findConversation.mockResolvedValue({ id: 'conversation-1', metadata: {} })
  h.updateConversation.mockResolvedValue({ id: 'conversation-1' })
  h.chatComplete.mockResolvedValue('SCENARIO: general\nCONFIDENCE: 0.9\nREPLY:\nWe open at 9 AM.')
  h.searchChunks.mockResolvedValue([{ chunkId: 'kb-chunk', documentId: 'kb-doc', documentVersion: 1, title: 'Hours', content: 'We open at 9 AM.', vectorScore: .99, lexicalScore: 1, retrievalRevision: 1, doctorId: null, language: 'en', provenance: {} }])
  h.recordLearning.mockResolvedValue({ replayed: false, candidate: null })
  h.learningSettings.mockResolvedValue({ autoApprove: false, groundingThreshold: 1, evidenceRetentionHours: 24 })
  h.sourcesCurrent.mockResolvedValue(true)
  h.isEmergencyMessage.mockReturnValue(false)
  h.scopedConsistency.mockResolvedValue({ complete: true, sources: ['We open at 9 AM.'] })
  h.queueAdd.mockResolvedValue(undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('processWorkflowRunJob automation ownership', () => {
  it.each(['emergency', 'provider_failure', 'no_match'])('records exactly one redacted terminal outcome for %s', async reason => {
    h.isEmergencyMessage.mockReturnValue(reason === 'emergency')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    if (reason === 'provider_failure') h.chatComplete.mockRejectedValue(new Error('secret-token patient Alex ZQ17'))
    if (reason === 'no_match') h.chatComplete.mockResolvedValue('SCENARIO: missing\nCONFIDENCE: 0.9\nREPLY: unused')
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.aiAgent({ id: 'terminal', type: 'action.ai_agent', config: { scenarios: reason === 'no_match' ? [] : [{ id: 'general', name: 'General', action: 'reply' }] } }, { ...ctx, message: 'hours?', conversationId: 'conversation-1' })
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.recordLearning).toHaveBeenCalledTimes(1)
    expect(h.recordLearning).toHaveBeenCalledWith(expect.objectContaining({ handoffReason: reason, answer: '' }))
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret-token')
  })
  it.each(['doctor_reassigned', 'governance_excluded'])('rechecks scope after generation for %s', async reason => {
    h.sourcesCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      expect(await exec.aiAgent({ id: reason, type: 'action.ai_agent', config: { scenarios: [{ id: 'general', name: 'General', action: 'reply' }] } }, { ...ctx, message: `hours ${reason}?`, doctor_id: 'doctor-a', conversationId: 'conversation-1' })).toBe('handoff')
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.sourcesCurrent).toHaveBeenLastCalledWith(CLINIC, expect.any(Array), { retrievalRevision: 1, doctorId: 'doctor-a', language: 'en' })
    expect(h.recordLearning).toHaveBeenCalledTimes(1)
    expect(h.recordLearning).toHaveBeenCalledWith(expect.objectContaining({ handoffReason: 'stale_or_missing_sources', retrievalRevision: 1, doctorId: 'doctor-a', language: 'en', citations: [expect.objectContaining({ retrievalRevision: 1, doctorId: null, governanceReviewState: 'trusted' })] }))
  })
  it.each([
    { reason: 'low_answer_confidence', confidence: 'NaN', answer: 'We open at 9 AM.', current: true },
    { reason: 'ungrounded_answer', confidence: '0.99', answer: 'We offer unlimited free care.', current: true },
    { reason: 'stale_or_missing_sources', confidence: '0.99', answer: 'We open at 9 AM.', current: false },
  ])('hands off instead of sending unsupported output: $reason', async ({ reason, confidence, answer, current }) => {
    h.chatComplete.mockResolvedValue(`SCENARIO: general\nCONFIDENCE: ${confidence}\nREPLY:\n${answer}`)
    h.sourcesCurrent.mockResolvedValue(current)
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const result = await exec.aiAgent({ id: 'ai-guard', type: 'action.ai_agent', config: { scenarios: [{ id: 'general', name: 'General', action: 'reply' }] } }, { ...ctx, message: `Tell me ${reason}`, conversationId: 'conversation-1' })
      expect(result).toBe('handoff'); return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.recordLearning).toHaveBeenCalledWith(expect.objectContaining({ handoffReason: reason }))
    expect(h.sendWhatsAppText.mock.calls.every(call => !String(call[3]).includes(answer))).toBe(true)
    expect(h.reviewLearning).not.toHaveBeenCalled()
  })

  it('persists a validated patient email captured by a workflow as the newest patient-provided value', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, automationMode: 'automated', email: 'old@example.com', phoneE164: null, fullName: null, metadata: {} })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.askAndCapture({
        id: 'capture-email',
        type: 'action.ask_capture',
        config: { field: 'patient_email', validation: 'email' },
      }, {
        ...ctx,
        message: 'patient@example.com',
        capture: { nodeId: 'capture-email', field: 'patient_email', validation: 'email', question: 'Email?', retryQuestion: 'Try again.', attempts: 0, maxAttempts: 3, status: 'pending' },
      })
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.updatePatient).toHaveBeenCalledWith(CLINIC, PATIENT, { email: 'patient@example.com' })
  })
  it.each([false, true])('uses the runtime auto-approval setting: %s', async autoApprove => {
    h.learningSettings.mockResolvedValue({ autoApprove, groundingThreshold: 1, evidenceRetentionHours: 24 })
    h.recordLearning.mockResolvedValue({ replayed: false, candidate: { id: 'candidate', status: 'pending_review', consistencyCount: 2, revision: 2 } })
    h.reviewLearning.mockResolvedValue({ write: { document: { id: 'published', version: 3 } } })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      expect(await exec.aiAgent({ id: 'ai-toggle', type: 'action.ai_agent', config: { scenarios: [{ id: 'general', name: 'General', action: 'reply' }] } }, { ...ctx, message: `Welcome ${autoApprove}`, conversationId: 'conversation-1' })).toBe('replied')
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.reviewLearning).toHaveBeenCalledTimes(autoApprove ? 1 : 0)
    if (autoApprove) expect(h.queueAdd).toHaveBeenCalledWith('embed-document', { clinicId: CLINIC, documentId: 'published', documentVersion: 3 })
  })
  it('gives separate inbound questions separate evidence keys while retries retain their key', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      for (const waMessageId of ['inbound-1', 'inbound-2', 'inbound-2']) await exec.aiAgent(
        { id: 'ai-evidence', type: 'action.ai_agent', config: { scenarios: [{ id: 'general', name: 'General', action: 'reply' }] } },
        { ...ctx, message: 'Hello', waMessageId, conversationId: 'conversation-1' },
      )
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    const keys = h.recordLearning.mock.calls.map(call => call[0].eventKey)
    expect(keys[0]).not.toBe(keys[1]); expect(keys[1]).toBe(keys[2])
  })
  it('pauses a generic wait at its downstream AI Agent until the next patient message', async () => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const paused = await exec.waitForReply(
        { id: 'wait-for-question', type: 'logic.wait_for_reply', config: { timeoutMinutes: 1440 } },
        'ai-agent',
        { ...ctx, conversationId: 'conversation-1' },
      )
      expect(paused).toBe(true)
      return [{ nodeId: 'wait-for-question', type: 'logic.wait_for_reply', status: 'paused' }]
    })

    await processWorkflowRunJob(job)

    expect(h.updateConversation).toHaveBeenCalledWith(
      CLINIC,
      'conversation-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          pendingWorkflowRuns: [expect.objectContaining({ resumeNodeId: 'ai-agent' })],
        }),
      }),
    )
  })

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

  it.each(['reason', 'appointment_reason', 'Appointment reason'])('persists the captured %s so calendar retries retain it', async (reasonField) => {
    h.createCalendarEvent.mockRejectedValueOnce(new Error('Calendar unavailable'))
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-reason', type: 'action.create_booking',
        config: { doctorId: '44444444-4444-4444-8444-444444444444' },
      }, { ...ctx, preferred_date: '2026-09-15', preferred_time: '09:00', [reasonField]: 'Follow-up consultation' })
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.saveWithinCapacity).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Follow-up consultation' }))
    expect(h.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('Reason for visit: Follow-up consultation') }))
    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, expect.any(String), expect.objectContaining({ calendarSyncPending: true }))
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

  it('offers only the current patient future appointments in a dynamic appointment menu', async () => {
    h.listPatientAppointments.mockResolvedValue([
      { id: 'future-appt', patientId: PATIENT, status: 'confirmed', startTime: '2026-09-15T09:00:00.000Z', endTime: '2026-09-15T09:30:00.000Z' },
      { id: 'cancelled-appt', patientId: PATIENT, status: 'cancelled', startTime: '2026-09-16T09:00:00.000Z', endTime: '2026-09-16T09:30:00.000Z' },
      { id: 'past-appt', patientId: PATIENT, status: 'confirmed', startTime: '2026-09-01T09:00:00.000Z', endTime: '2026-09-01T09:30:00.000Z' },
    ])
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.sendInteractiveMenu({
        id: 'appointment-menu',
        type: 'action.interactive_menu',
        config: { optionSource: 'patient_appointments', field: 'appointment_id', message: 'Choose an appointment' },
      }, { ...ctx, conversationId: 'conversation-1' }, 0)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.listPatientAppointments).toHaveBeenCalledWith(CLINIC, PATIENT)
    expect(h.sendWhatsAppInteractiveList).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({
      options: [expect.objectContaining({ id: 'future-appt' })],
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

  it.each(['openai', 'claude'])('honors the selected %s provider and patient language', async (provider) => {
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const result = exec.aiAgent
        ? await exec.aiAgent({
            id: 'ai-agent',
            type: 'ai_agent',
            config: {
              agentProvider: provider,
              agentModel: 'test-model',
              agentMaxTokens: '2048',
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
      provider,
      model: 'test-model',
      maxTokens: 2048,
    }))
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'We open at 9 AM.',
    )
  })

  it.each(['openai', 'claude'])('preserves %s settings but hands off an unverified catch-all fallback reply', async (provider) => {
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
              agentProvider: provider,
              agentModel: 'fallback-model',
              agentMaxTokens: 1024,
              scenarios: [
                { id: 'scenario_1', description: 'Answers any question', action: 'reply' },
              ],
            },
          }, { ...ctx, message: 'What services do you offer?', preferred_language: 'English' })
        : 'missing'
      expect(result).toBe('handoff')
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.chatComplete).toHaveBeenCalledTimes(2)
    for (const [options] of h.chatComplete.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ provider, model: 'fallback-model', maxTokens: 1024 }))
    }
    expect(h.sendWhatsAppText).toHaveBeenCalledWith(
      'phone-1',
      'token',
      '15551234567',
      'A secretary will help you.',
    )
  })

  it('reschedules workflow bookings through the atomic capacity operation', async () => {
    h.listSlots.mockResolvedValue([{ start: '2026-09-15T09:00:00', end: '2026-09-15T10:00:00' }])
    h.findAppointment.mockResolvedValue({
      id: 'appt-existing', patientId: PATIENT, doctorId: '44444444-4444-4444-8444-444444444444', serviceId: null,
      status: 'confirmed', startTime: '2026-09-14T09:00:00.000Z', endTime: '2026-09-14T10:00:00.000Z', googleEventId: 'event-original', notes: 'Original consultation',
    })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await exec.createOrRescheduleBooking({
        id: 'booking-1',
        type: 'action.reschedule_booking',
        config: {
          dateField: 'preferred_date',
          timeField: 'preferred_time',
          appointmentIdField: 'appointment_id',
          durationMinutes: 30,
        },
      }, {
        ...ctx,
        appointment_id: 'appt-existing',
        reason: 'Stale reason from another booking',
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
      endTime: '2026-09-15T10:00:00.000Z',
    }))
    expect(h.updateAppointment).not.toHaveBeenCalledWith(
      CLINIC,
      'appt-existing',
      expect.objectContaining({ startTime: expect.any(String) }),
    )
    expect(h.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-original', durationMinutes: 60, description: expect.stringContaining('Original consultation') }))
    expect(h.updateCalendarEvent.mock.calls[0]?.[0].description).not.toContain('Stale reason')
  })

  it('keeps a failed Google cancellation pending after the Docmee cancellation is saved', async () => {
    h.findAppointment.mockResolvedValue({ id: 'appt-existing', patientId: PATIENT, status: 'confirmed', doctorId: '44444444-4444-4444-8444-444444444444', googleEventId: 'event-original' })
    h.deleteCalendarEvent.mockRejectedValue(new Error('Calendar unavailable'))
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const bookingCtx = { ...ctx, appointment_id: 'appt-existing' }
      await exec.cancelBooking({ id: 'cancel', type: 'action.cancel_booking', config: {} }, bookingCtx)
      expect(bookingCtx.calendar_sync_pending).toBe(true)
      expect(bookingCtx.booking_status).toBe('cancelled')
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, 'appt-existing', expect.objectContaining({ status: 'cancelled', calendarSyncPending: true }))
    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, 'appt-existing', expect.objectContaining({ calendarSyncError: 'Calendar unavailable' }))
  })

  it('loads rescheduling availability for the original doctor and full appointment duration', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T00:00:00Z'))
    h.findAppointment.mockResolvedValue({ id: 'appt-existing', patientId: PATIENT, doctorId: '44444444-4444-4444-8444-444444444444', serviceId: 'service-original', status: 'confirmed', startTime: '2026-09-14T09:00:00.000Z', endTime: '2026-09-14T10:00:00.000Z' })
    h.listSlots.mockResolvedValue([
      { start: '2026-09-15T09:00:00', end: '2026-09-15T09:30:00' },
      { start: '2026-09-15T09:30:00', end: '2026-09-15T10:00:00' },
    ])
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const bookingCtx = { ...ctx, appointment_id: 'appt-existing', doctor_id: 'stale-doctor', preferred_date: '2026-09-15' }
      await exec.checkAvailability({ id: 'availability', type: 'action.check_availability', config: { appointmentIdField: 'appointment_id', days: 1 } }, bookingCtx)
      expect(bookingCtx.doctor_id).toBe('44444444-4444-4444-8444-444444444444')
      expect(bookingCtx.service_id).toBe('service-original')
      expect(bookingCtx.available_slots).toEqual([{ start: '2026-09-15T09:00:00', end: '2026-09-15T09:30:00' }])
      return [{ status: 'completed' }]
    })
    await processWorkflowRunJob(job)
    expect(h.findAppointment).toHaveBeenCalledWith(CLINIC, 'appt-existing')
  })


  it('cancels only the current patient appointment and removes its Google event', async () => {
    h.findAppointment.mockResolvedValue({
      id: 'appt-existing', patientId: PATIENT, doctorId: '44444444-4444-4444-8444-444444444444',
      status: 'confirmed', googleEventId: 'google-event-1',
    })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      const bookingCtx = { ...ctx, appointment_id: 'appt-existing' }
      await exec.cancelBooking({
        id: 'cancel-1', type: 'action.cancel_booking', config: { appointmentIdField: 'appointment_id' },
      }, bookingCtx)
      expect(bookingCtx.booking_status).toBe('cancelled')
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, 'appt-existing', expect.objectContaining({ status: 'cancelled' }))
    expect(h.addAppointmentEvent).toHaveBeenCalledWith(CLINIC, 'appt-existing', 'cancelled')
    expect(h.deleteCalendarEvent).toHaveBeenCalledWith('google-event-1')
    expect(h.updateAppointment).toHaveBeenCalledWith(CLINIC, 'appt-existing', expect.objectContaining({ googleEventId: null, calendarSyncPending: false }))
  })

  it('refuses to cancel another patient appointment', async () => {
    h.findAppointment.mockResolvedValue({ id: 'appt-other', patientId: 'another-patient', status: 'confirmed', googleEventId: null })
    h.runWorkflow.mockImplementation(async (_workflow, ctx, exec) => {
      await expect(exec.cancelBooking({
        id: 'cancel-1', type: 'action.cancel_booking', config: { appointmentIdField: 'appointment_id' },
      }, { ...ctx, appointment_id: 'appt-other' })).rejects.toThrow(/does not belong to this patient/)
      return [{ status: 'completed' }]
    })

    await processWorkflowRunJob(job)

    expect(h.updateAppointment).not.toHaveBeenCalled()
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
