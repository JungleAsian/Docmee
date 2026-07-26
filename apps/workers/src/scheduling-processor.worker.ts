// Consumes: scheduling queue (enqueued by the agent worker for calbot routes).
//
// Routes each job to the matching scheduling flow:
//   book       → advanceBookingFlow
//   reschedule → advanceRescheduleFlow
//   cancel     → advanceCancelFlow
//   status     → buildStatusReply
//
// Multi-turn flow state is persisted in conversations.metadata.scheduling so the
// next inbound message resumes where the patient left off. Google Calendar access
// is bound from the clinic's encrypted OAuth tokens (clinics.settings.googleCalendar).
import { z } from 'zod'
import { decryptValue, encryptValue } from '@docmee/shared'
import {
  detectLanguage,
  createGoogleCalendarOps,
  type BookingGrid,
  advanceBookingFlow,
  initialBookingState,
  advanceRescheduleFlow,
  initialRescheduleState,
  advanceCancelFlow,
  initialCancelState,
  buildStatusReply,
  normalizeAvailability,
  type CalendarOps,
  type Language,
  type ProviderRef,
  type UpcomingAppointment,
  type BookingState,
  type RescheduleState,
  type CancelState,
  type RefreshedTokens,
} from '@docmee/agents'
import { notificationQueue, type Job } from '@docmee/queue'
import { patientSource, mergePatientIntake, type BookingIntake } from './intake.js'
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'
import { scheduleAppointmentFollowUps, scheduleNoResponseFollowUp } from './follow-up.js'
import { createClinicCrmExporter, patientPhone } from './crm.js'
import {
  createServiceDbClient,
  createClinicsRepository,
  createPatientsRepository,
  createConversationsRepository,
  createMessagesRepository,
  createAppointmentsRepository,
  createChannelAccountsRepository,
  createDoctorsRepository,
  createDoctorServicesRepository,
  createErrorReviewsRepository,
  type Clinic,
  type Patient,
  type Appointment,
  type Provider,
  type Doctor,
} from '@docmee/db'

const SchedulingJobSchema = z.object({
  clinicId: z.string().uuid(),
  patientWaId: z.string(),
  phoneNumberId: z.string().optional(),
  message: z.string(),
  waMessageId: z.string(),
  patientId: z.string().uuid().optional(),
  isNewPatient: z.boolean().optional(),
  conversationId: z.string().uuid().optional(),
  action: z.enum(['book', 'reschedule', 'cancel', 'status']),
})

export type SchedulingJobData = z.infer<typeof SchedulingJobSchema>
type Action = SchedulingJobData['action']

interface CalendarConfig {
  accessToken: string
  refreshToken: string
  calendarId: string
  expiryDate?: number
}

// Per-action persisted state lives under conversations.metadata.scheduling.
type StoredFlow =
  | { action: 'book'; state: BookingState }
  | { action: 'reschedule'; state: RescheduleState }
  | { action: 'cancel'; state: CancelState }

function getPatientLanguage(patient: Patient | null): Language {
  const lang = patient ? (patient.metadata as { language?: unknown }).language : undefined
  return lang === 'en' ? 'en' : 'es'
}

// P18 (Gap #32): a doctor's own Google Calendar, decrypted from their row.
// Returns null when the doctor has no calendar connected (→ fall back to clinic).
function getDoctorCalendarConfig(doctor: Doctor): CalendarConfig | null {
  const acc = doctor.googleCalendarAccessTokenEncrypted
  const ref = doctor.googleCalendarRefreshTokenEncrypted
  if (!acc || !ref) return null
  try {
    return {
      accessToken: decryptValue(acc),
      refreshToken: decryptValue(ref),
      calendarId: doctor.googleCalendarId ?? 'primary',
    }
  } catch {
    return null
  }
}

// Persist a refreshed Google access token back onto a doctor's row so the next
// job reuses it instead of refreshing again. Best-effort: a write failure is
// logged but never breaks the in-flight scheduling reply.
function persistDoctorTokens(
  sql: ReturnType<typeof createServiceDbClient>,
  clinicId: string,
  doctorId: string,
): (t: RefreshedTokens) => Promise<void> {
  return async (t) => {
    try {
      await createDoctorsRepository(sql).update(clinicId, doctorId, {
        googleCalendarAccessTokenEncrypted: encryptValue(t.accessToken),
        ...(t.refreshToken ? { googleCalendarRefreshTokenEncrypted: encryptValue(t.refreshToken) } : {}),
      })
    } catch (e) {
      console.error(`[scheduling] failed to persist refreshed doctor calendar tokens for ${doctorId}`, e)
    }
  }
}

// Placeholder bound to the booking flow on early turns (doctor not yet chosen) when
// no clinic calendar exists. The flow never touches the calendar before a doctor is
// selected, so these throws are unreachable in practice — they guard against misuse.
const unconfiguredCalendar: CalendarOps = {
  listSlots: () => Promise.reject(new Error('calendar not configured')),
  createEvent: () => Promise.reject(new Error('calendar not configured')),
  updateEvent: () => Promise.reject(new Error('calendar not configured')),
  deleteEvent: () => Promise.reject(new Error('calendar not configured')),
}

function getCalendarConfig(clinic: Clinic): CalendarConfig | null {
  const gc = (clinic.settings as { googleCalendar?: unknown }).googleCalendar
  if (!gc || typeof gc !== 'object') return null
  const { accessToken, refreshToken, calendarId, expiryDate } = gc as Record<string, unknown>
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  try {
    return {
      accessToken: decryptValue(accessToken),
      refreshToken: decryptValue(refreshToken),
      calendarId: typeof calendarId === 'string' ? calendarId : 'primary',
      ...(typeof expiryDate === 'number' ? { expiryDate } : {}),
    }
  } catch {
    // Tokens unreadable (rotated key / corruption) → treat as not connected.
    return null
  }
}

// CRE-47: per-clinic bookable grid from clinics.settings.bookingGrid. Defensive —
// an invalid/absent setting returns undefined so the calendar keeps the default
// 09:00–18:00 / 30-min grid.
function parseBookingGrid(settings: unknown): BookingGrid | undefined {
  const raw = (settings as { bookingGrid?: unknown } | null)?.bookingGrid
  if (!raw || typeof raw !== 'object') return undefined
  const g = raw as Record<string, unknown>
  const startHour = Number(g['startHour'])
  const endHour = Number(g['endHour'])
  const slotMinutes = Number(g['slotMinutes'])
  if (![startHour, endHour, slotMinutes].every(Number.isFinite)) return undefined
  if (startHour < 0 || endHour > 24 || startHour >= endHour || slotMinutes <= 0) return undefined
  return { startHour, endHour, slotMinutes }
}

function toProviderRef(p: Provider): ProviderRef {
  return { id: p.id, fullName: p.fullName, specialty: p.specialty }
}

function toUpcoming(appt: Appointment, providers: Provider[]): UpcomingAppointment {
  const provider = providers.find((p) => p.id === appt.providerId)
  return {
    id: appt.id,
    providerId: appt.providerId ?? appt.doctorId ?? '',
    providerName: provider?.fullName ?? 'el doctor',
    date: appt.startTime.slice(0, 10),
    time: appt.startTime.slice(11, 16),
    googleEventId: appt.googleEventId,
  }
}

function isUpcoming(appt: Appointment, nowIso: string): boolean {
  return (appt.status === 'pending' || appt.status === 'confirmed') && appt.startTime > nowIso
}

// The booked length of an existing appointment, so a reschedule preserves the
// service duration (Req 30) instead of defaulting to 30 minutes. Returns undefined
// for malformed/empty rows so the flow falls back to its default.
function apptDurationMinutes(appt: Appointment): number | undefined {
  const start = Date.parse(appt.startTime)
  const end = Date.parse(appt.endTime)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined
  return Math.round((end - start) / 60000)
}

function loadStoredFlow(metadata: Record<string, unknown>, action: Action): StoredFlow | null {
  const stored = metadata['scheduling']
  if (stored && typeof stored === 'object' && (stored as StoredFlow).action === action) {
    return stored as StoredFlow
  }
  return null
}

export async function processSchedulingJob(job: Job): Promise<void> {
  const data = SchedulingJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const clinics = createClinicsRepository(sql)
    const patients = createPatientsRepository(sql)
    const conversations = createConversationsRepository(sql)
    const appointments = createAppointmentsRepository(sql)
    const channelAccounts = createChannelAccountsRepository(sql)

    const clinic = await clinics.findById(data.clinicId)
    if (!clinic) {
      console.warn(`[scheduling] unknown clinic ${data.clinicId}; dropping ${data.waMessageId}`)
      return
    }

    const account = activeWhatsAppAccount(await channelAccounts.listByClinic(data.clinicId), data.phoneNumberId)
    const sendReply = resolveWhatsAppSender(account, data.patientWaId)
    if (!account || !sendReply) {
      console.warn(`[scheduling] no active WhatsApp account for clinic ${data.clinicId}; cannot reply`)
      return
    }
    const messages = createMessagesRepository(sql)
    const reply = async (text: string): Promise<string | null> => {
      const channelMessageId = await sendReply(text)
      if (data.conversationId) {
        try {
          await messages.create({
            conversationId: data.conversationId,
            clinicId: data.clinicId,
            role: 'assistant',
            content: text,
            ...(channelMessageId ? { channelMessageId } : {}),
          })
        } catch (error) {
          // Delivery already succeeded. Preserve the patient-facing result and surface
          // the observability failure for repair rather than retrying a duplicate send.
          console.error('[scheduling] failed to persist outbound WhatsApp reply', error)
        }
      }
      return channelMessageId
    }

    const patient = data.patientId ? await patients.findById(data.clinicId, data.patientId) : null
    const language: Language = data.isNewPatient ? detectLanguage(data.message) : getPatientLanguage(patient)
    const clinicInfo = { name: clinic.name, timezone: clinic.timezone }

    // Scheduling needs a known patient (to own the appointment row).
    if (!data.patientId) {
      await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
      return
    }
    const patientId = data.patientId

    const conversation = data.conversationId
      ? await conversations.findById(data.clinicId, data.conversationId)
      : null
    const metadata: Record<string, unknown> = conversation ? { ...conversation.metadata } : {}
    // Whether a multi-turn flow was already mid-stream when this message arrived.
    // Used to schedule the no_response nudge only on the FIRST turn we start waiting
    // on the patient, so a long booking conversation doesn't queue a nudge per turn.
    const hadStoredFlow = metadata['scheduling'] != null

    const providers = await appointments.listProviders(data.clinicId)
    const calendarConfig = getCalendarConfig(clinic)

    // Persist a refreshed clinic access token back into clinics.settings so the
    // next job reuses it (best-effort; re-reads the row to merge against the
    // latest settings rather than the snapshot taken at the top of the job).
    const persistClinicTokens = async (t: RefreshedTokens): Promise<void> => {
      try {
        const fresh = await clinics.findById(data.clinicId)
        const gc = fresh
          ? (fresh.settings as { googleCalendar?: Record<string, unknown> }).googleCalendar
          : null
        if (!fresh || !gc) return
        await clinics.update(data.clinicId, {
          settings: {
            ...fresh.settings,
            googleCalendar: {
              ...gc,
              accessToken: encryptValue(t.accessToken),
              ...(t.refreshToken ? { refreshToken: encryptValue(t.refreshToken) } : {}),
              ...(typeof t.expiryDate === 'number' ? { expiryDate: t.expiryDate } : {}),
            },
          },
        })
      } catch (e) {
        console.error(`[scheduling] failed to persist refreshed clinic calendar tokens for ${data.clinicId}`, e)
      }
    }

    const calendar: CalendarOps | null = calendarConfig
      ? createGoogleCalendarOps({ ...calendarConfig, timezone: clinic.timezone, grid: parseBookingGrid(clinic.settings), onTokensRefreshed: persistClinicTokens })
      : null

    const patientAppointments = await appointments.listByPatient(data.clinicId, patientId)
    const nowIso = new Date().toISOString()
    const upcoming = patientAppointments.filter((a) => isUpcoming(a, nowIso))

    let nextFlow: StoredFlow | null = null

    // Calendar failures (Req 29 Error Review): a Google Calendar call inside any
    // scheduling flow can throw (expired/revoked OAuth token, API outage, quota).
    // Rather than let the job fail and retry — which risks a double-book or a
    // double-send — we record the failure to error_reviews for operator review,
    // tell the patient a human will follow up, and hand off. Best-effort logging.
    try {
      switch (data.action) {
      case 'status': {
        const result = buildStatusReply({
          language,
          clinic: clinicInfo,
          appointments: upcoming.map((a) => toUpcoming(a, providers)),
        })
        await reply(result.reply)
        break
      }

      case 'cancel': {
        const stored = loadStoredFlow(metadata, 'cancel')
        const state = stored?.action === 'cancel' ? stored.state : initialCancelState()
        const result = await advanceCancelFlow(state, data.message, { language, appointment: upcoming[0] ? toUpcoming(upcoming[0], providers) : null }, {
          deleteEvent: async (eventId) => {
            if (calendar) await calendar.deleteEvent(eventId)
          },
          markCancelled: async (appointmentId) => {
            await appointments.update(data.clinicId, appointmentId, { status: 'cancelled' })
            await appointments.addEvent(data.clinicId, appointmentId, 'cancelled')
          },
        })
        await reply(result.reply)
        nextFlow = result.done ? null : { action: 'cancel', state: result.nextState }
        break
      }

      case 'reschedule': {
        const target = upcoming[0]
        const upcomingRef = target ? toUpcoming(target, providers) : null

        // Req 30: a reschedule must move the appointment on the SAME doctor's
        // calendar and stay inside that doctor's working hours — not just the
        // clinic calendar. Resolve the booked doctor (doctor-mode only; legacy
        // provider appointments fall back to the clinic calendar unchanged).
        const doctors = await createDoctorsRepository(sql).listByClinic(data.clinicId)
        const apptDoctor =
          upcomingRef && doctors.length > 0
            ? doctors.find((d) => d.id === upcomingRef.providerId)
            : undefined

        let rescheduleCalendar: CalendarOps | null = calendar
        if (apptDoctor) {
          const docCal = getDoctorCalendarConfig(apptDoctor)
          rescheduleCalendar = docCal
            ? createGoogleCalendarOps({
                ...docCal,
                timezone: clinic.timezone,
                grid: parseBookingGrid(clinic.settings),
                onTokensRefreshed: persistDoctorTokens(sql, data.clinicId, apptDoctor.id),
              })
            : calendar
        }

        if (!rescheduleCalendar) {
          await reply(calendarUnavailable(language))
          await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
          break
        }

        const stored = loadStoredFlow(metadata, 'reschedule')
        const state = stored?.action === 'reschedule' ? stored.state : initialRescheduleState()
        const result = await advanceRescheduleFlow(state, data.message, {
          language,
          clinic: clinicInfo,
          appointment: upcomingRef,
          ...(apptDoctor ? { availability: normalizeAvailability(apptDoctor.availableDays) } : {}),
          ...(target ? { serviceDurationMinutes: apptDurationMinutes(target) } : {}),
        }, {
          calendar: rescheduleCalendar,
          applyReschedule: async ({ appointmentId, startTime, endTime }) => {
            await appointments.update(data.clinicId, appointmentId, { startTime, endTime, status: 'confirmed' })
            await appointments.addEvent(data.clinicId, appointmentId, 'rescheduled')
          },
        })
        await reply(result.reply)
        nextFlow = result.done ? null : { action: 'reschedule', state: result.nextState }
        break
      }

      case 'book': {
        const stored = loadStoredFlow(metadata, 'book')
        const state = stored?.action === 'book' ? stored.state : initialBookingState()

        // P18 (Gap #32): prefer the clinic's doctors as bookable resources. When a
        // doctor is chosen (state.providerId holds the doctor id), use THAT doctor's
        // own calendar, falling back to the clinic calendar.
        const doctors = await createDoctorsRepository(sql).listByClinic(data.clinicId)
        const doctorMode = doctors.length > 0

        let bookingCalendar: CalendarOps | null = calendar
        if (doctorMode && state.providerId) {
          const doctor = doctors.find((d) => d.id === state.providerId)
          const docCal = doctor ? getDoctorCalendarConfig(doctor) : null
          bookingCalendar = docCal && doctor
            ? createGoogleCalendarOps({
                ...docCal,
                timezone: clinic.timezone,
                grid: parseBookingGrid(clinic.settings),
                onTokensRefreshed: persistDoctorTokens(sql, data.clinicId, doctor.id),
              })
            : calendar
        }

        // A calendar is required once we have a selection (or in legacy provider mode);
        // before a doctor is picked it isn't touched, so we can proceed without one.
        if (!bookingCalendar && (state.providerId || !doctorMode)) {
          await reply(calendarUnavailable(language))
          await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
          break
        }

        // Req 30: each doctor carries their own working hours AND the services they
        // offer; the chosen service's duration sets the appointment slot length. The
        // doctor-services repo is only touched in doctor mode (legacy providers have
        // no per-doctor services).
        const resourceList: ProviderRef[] = doctorMode
          ? await (async () => {
              const doctorServicesRepo = createDoctorServicesRepository(sql)
              return Promise.all(
                doctors.map(async (d) => ({
                  id: d.id,
                  fullName: d.name,
                  specialty: d.specialty,
                  availability: normalizeAvailability(d.availableDays),
                  services: (await doctorServicesRepo.listServicesForDoctor(data.clinicId, d.id)).map((s) => ({
                    id: s.id,
                    name: s.name,
                    durationMinutes: s.durationMinutes,
                  })),
                })),
              )
            })()
          : providers.map(toProviderRef)

        const result = await advanceBookingFlow(state, data.message, {
          language,
          clinic: clinicInfo,
          providers: resourceList,
          patientName: patient?.fullName ?? null,
        }, {
          calendar: bookingCalendar ?? unconfiguredCalendar,
          saveAppointment: async ({ providerId, doctorName, specialty, serviceId, startTime, endTime, reason, preferredDate, preferredTime, googleEventId }) => {
            // Req 10: the full intake captured during the flow (reason, the
            // patient's preferred date/time, the chosen doctor + specialty + service
            // and the originating source channel) is persisted onto the appointment...
            const intake: BookingIntake = {
              reason,
              preferredDate,
              preferredTime,
              doctorId: providerId,
              doctorName,
              specialty,
              source: patientSource(patient),
              ...(serviceId ? { serviceId } : {}),
            }
            const created = await appointments.create({
              clinicId: data.clinicId,
              patientId,
              ...(doctorMode ? { doctorId: providerId } : { providerId }),
              ...(serviceId ? { serviceId } : {}),
              conversationId: data.conversationId,
              startTime,
              endTime,
              notes: reason,
              metadata: { intake },
            })
            await appointments.update(data.clinicId, created.id, { status: 'confirmed', googleEventId })
            await appointments.addEvent(data.clinicId, created.id, 'confirmed')
            // ...and merged onto the patient record so it is queryable from the
            // patient view, not only buried in the appointment. Best-effort: a
            // write failure is logged but never breaks the confirmation reply.
            if (patient) {
              try {
                await patients.update(data.clinicId, patient.id, {
                  metadata: mergePatientIntake(patient.metadata, intake),
                })
              } catch (e) {
                console.error(`[scheduling] failed to persist patient intake for ${patient.id}`, e)
              }
            }
            // Auto-tag the conversation as appointment_scheduled (Req 11). Idempotent.
            if (data.conversationId) {
              const tag = await conversations.createTag({
                clinicId: data.clinicId,
                name: 'appointment_scheduled',
                color: '#2563eb',
              })
              await conversations.addTag(data.clinicId, data.conversationId, tag.id)
            }

            // Follow-up automation (Rev1 #14): schedule the appointment-relative
            // follow-ups (confirmation, reminder, post-consultation, 7-day, 3-month)
            // as delayed jobs. Best-effort — a queue failure never breaks the booking.
            await scheduleAppointmentFollowUps({
              clinicId: data.clinicId,
              patientId,
              appointmentId: created.id,
              startTime,
              endTime,
            })

            // Req 31 (CRM / Google Sheets): mirror the confirmed appointment as a
            // row in the clinic's configured Sheet (source, status, scheduled flag,
            // clinic scoping). Opt-in per clinic. Best-effort — a Sheets failure is
            // recorded to error_reviews and never breaks the booking confirmation.
            const crm = createClinicCrmExporter(clinic, persistClinicTokens)
            if (crm) {
              try {
                await crm.appendRow({
                  recordType: 'appointment',
                  timestamp: new Date().toISOString(),
                  clinicId: data.clinicId,
                  clinicName: clinic.name,
                  patientName: patient?.fullName ?? '',
                  phone: patientPhone(patient, data.patientWaId),
                  source: patientSource(patient) ?? '',
                  doctorName: doctorName ?? '',
                  specialty: specialty ?? '',
                  reason,
                  appointmentDate: startTime.slice(0, 10),
                  appointmentTime: startTime.slice(11, 16),
                  status: 'confirmed',
                  scheduled: true,
                })
              } catch (e) {
                console.error(`[scheduling] CRM export failed for clinic ${data.clinicId}`, e)
                await createErrorReviewsRepository(sql)
                  .create({
                    clinicId: data.clinicId,
                    errorType: 'crm_export_failure',
                    errorMessage: e instanceof Error ? e.message : String(e),
                    context: {
                      conversationId: data.conversationId ?? null,
                      appointmentId: created.id,
                      patientId,
                    },
                  })
                  .catch((logErr) => console.error('[scheduling] failed to log CRM export failure:', logErr))
              }
            }
          },
        })
        await reply(result.reply)
        if (result.handoff) await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
        nextFlow = result.done ? null : { action: 'book', state: result.nextState }
        break
      }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      // A response send happens within the booking flow's guarded section. Keep
      // delivery outages out of the calendar-failure queue so operators can act on
      // the real provider incident rather than chase a nonexistent Calendar fault.
      const errorType = /(?:meta[_ ]?send|whatsapp|zernio|phone[_ ]?number)/i.test(errorMessage)
        ? 'whatsapp_delivery_failure'
        : 'calendar_failure'
      console.error(`[scheduling] ${errorType} for clinic ${data.clinicId} (${data.action}):`, err)
      await createErrorReviewsRepository(sql)
        .create({
          clinicId: data.clinicId,
          errorType,
          errorMessage,
          context: {
            conversationId: data.conversationId ?? null,
            action: data.action,
            patientId: data.patientId ?? null,
          },
        })
        .catch((logErr) => console.error('[scheduling] failed to log calendar failure:', logErr))
      // Tell the patient a human will follow up and hand off; do not persist a
      // partially-advanced flow (we return without writing flow state).
      await reply(calendarUnavailable(language)).catch(() => {})
      await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
      return
    }

    // Persist (or clear) the flow state for the next inbound message.
    if (conversation) {
      const updated = { ...metadata }
      if (nextFlow) updated['scheduling'] = nextFlow
      else delete updated['scheduling']
      await conversations.update(data.clinicId, conversation.id, { metadata: updated })

      // Follow-up automation (Rev1 #14): the flow asked the patient something and is
      // now waiting on them. Schedule a single no_response nudge on the first such
      // turn; the follow-up worker self-cancels it if the patient replies in time.
      if (nextFlow && !hadStoredFlow) {
        await scheduleNoResponseFollowUp({
          clinicId: data.clinicId,
          patientId,
          conversationId: conversation.id,
          silentSinceIso: nowIso,
        })
      }
    }
  } finally {
    await sql.end()
  }
}

function calendarUnavailable(language: Language): string {
  return language === 'en'
    ? 'Our scheduling system is not available right now. A team member will contact you shortly.'
    : 'Nuestro sistema de agendamiento no está disponible en este momento. Un miembro del equipo le contactará en breve.'
}
