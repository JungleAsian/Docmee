// Consumes: review-request queue (Gap #37 — review automation).
//
// A periodic tick scans each clinic for appointments completed between 48h and 7
// days ago that have not yet had a review request, and sends one over WhatsApp:
//   "¿Cómo fue tu experiencia con [Doctor]? Déjanos tu opinión: [link]"
// Opted-out patients are never messaged. Each send is recorded in follow_ups (so
// it fires exactly once) and, when a tracking base URL is configured, the link is
// a redirector that stamps review_clicked.
//
// Meta compliance (Req 19): a review request is an unsolicited, proactive send.
// Because it goes out 48h–7d after the appointment it is almost always OUTSIDE
// Meta's 24-hour customer-care window, where only an approved HSM template may be
// sent. So we re-check the window per patient at send time: inside it we may send
// the free-text invite; outside it we require the clinic's approved 'review_request'
// template and skip (without claiming, so a later run can retry once the template is
// approved) when none exists.
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'
import { type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createAppointmentsRepository,
  createDoctorsRepository,
  createPatientsRepository,
  createChannelAccountsRepository,
  createFollowUpsRepository,
  createMessagesRepository,
  createMessageTemplatesRepository,
  type Clinic,
  type Patient,
  type PatientContact,
} from '@docmee/db'
import { isWithinCustomerCareWindow } from './follow-up.js'
import { isHumanOnly } from '@docmee/shared'
import { resolveAutomationEligiblePatient } from './automation-patient-guard.js'

export const REVIEW_FOLLOW_UP_TYPE = 'review_request'

/** The approved-template category that carries a review request outside the 24h window. */
export const REVIEW_TEMPLATE_CATEGORY = 'review_request' as const

const REVIEW_DELAY_HOURS = 48
const REVIEW_WINDOW_DAYS = 7

type Language = 'es' | 'en'

function getPatientLanguage(patient: Patient): Language {
  return (patient.metadata as { language?: unknown }).language === 'en' ? 'en' : 'es'
}

function isPatientOptedOut(patient: Patient): boolean {
  return (patient.metadata as { optedOut?: unknown }).optedOut === true
}

function primaryWhatsAppHandle(contacts: PatientContact[]): string | null {
  const whatsapp = contacts.filter((c) => c.channel === 'whatsapp')
  return (whatsapp.find((c) => c.isPrimary) ?? whatsapp[0])?.contactHandle ?? null
}

function getReviewLink(clinic: Clinic): string | null {
  const link = (clinic.settings as { reviewLink?: unknown }).reviewLink
  return typeof link === 'string' && link ? link : null
}

/** Tracking redirect if a public base URL is set; otherwise the raw review link. */
export function buildReviewLink(followUpId: string, fallback: string): string {
  const base = process.env['PUBLIC_API_URL']?.replace(/\/$/, '')
  return base ? `${base}/r/${followUpId}` : fallback
}

function reviewMessage(language: Language, doctorName: string, link: string): string {
  return language === 'en'
    ? `How was your experience with ${doctorName}? Leave us your feedback: ${link}`
    : `¿Cómo fue tu experiencia con ${doctorName}? Déjanos tu opinión: ${link}`
}

export async function processReviewRequestJob(_job: Job): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  const now = new Date()
  const to = new Date(now.getTime() - REVIEW_DELAY_HOURS * 60 * 60 * 1000)
  const from = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  try {
    const clinics = createClinicsRepository(sql)
    const appointments = createAppointmentsRepository(sql)
    const doctors = createDoctorsRepository(sql)
    const patients = createPatientsRepository(sql)
    const channelAccounts = createChannelAccountsRepository(sql)
    const followUps = createFollowUpsRepository(sql)
    const messages = createMessagesRepository(sql)
    const templates = createMessageTemplatesRepository(sql)
    const nowIso = now.toISOString()

    for (const clinic of await clinics.list()) {
      if (clinic.status !== 'active') continue

      // Screen 12 (Automation builder): skip clinics that switched review-request
      // automation off. Absent flag = enabled (default-on).
      const reviewEnabled =
        (clinic.settings as { automations?: { reviewRequest?: { enabled?: boolean } } }).automations
          ?.reviewRequest?.enabled !== false
      if (!reviewEnabled) continue

      const reviewLink = getReviewLink(clinic)
      if (!reviewLink) continue // nothing to point patients at

      const completed = await appointments.listCompletedForReview(
        clinic.id,
        from.toISOString(),
        to.toISOString(),
      )
      if (completed.length === 0) continue

      const account = activeWhatsAppAccount(await channelAccounts.listByClinic(clinic.id))
      if (!account) continue

      const doctorList = await doctors.listByClinic(clinic.id)

      for (const appt of completed) {
        const patient = await patients.findById(clinic.id, appt.patientId)
        if (!patient || isPatientOptedOut(patient) || isHumanOnly(patient)) continue

        const handle = primaryWhatsAppHandle(await patients.listContacts(clinic.id, appt.patientId))
        if (!handle) continue
        const sendWhatsApp = resolveWhatsAppSender(account, handle)
        if (!sendWhatsApp) continue

        const language = getPatientLanguage(patient)

        // 24-hour customer-care window (Req 19 Meta Compliance). A review request is
        // proactive, so outside the window we may only send the clinic's approved HSM
        // template; with none approved we skip WITHOUT claiming the follow-up, so a
        // later tick can deliver it once a template is approved.
        const lastInbound = await messages.findLastInboundAt(clinic.id, appt.patientId)
        const inWindow = isWithinCustomerCareWindow(lastInbound, nowIso)
        let template = null
        if (!inWindow) {
          template = await templates.findApprovedByCategory(clinic.id, REVIEW_TEMPLATE_CATEGORY)
          if (!template) continue
        }

        // Claim this (appointment, type) exactly once — only now that we can send.
        const followUp = await followUps.createIfAbsent({
          clinicId: clinic.id,
          patientId: appt.patientId,
          appointmentId: appt.id,
          type: REVIEW_FOLLOW_UP_TYPE,
        })
        if (!followUp) continue // already handled in a prior run

        const doctorName =
          doctorList.find((d) => d.id === appt.doctorId)?.name ??
          (language === 'en' ? 'your doctor' : 'tu doctor')
        const link = buildReviewLink(followUp.id, reviewLink)
        // Inside the window: free-text invite. Outside: the approved template body,
        // with the tracked review link appended so click-through is still recorded.
        const text = inWindow
          ? reviewMessage(language, doctorName, link)
          : `${template!.body} ${link}`

        const deliveryPatient = await resolveAutomationEligiblePatient(
          patients,
          clinic.id,
          appt.patientId,
          'review-request',
        )
        if (!deliveryPatient) continue

        await sendWhatsApp(text)
        await followUps.markSent(clinic.id, followUp.id)
      }
    }
  } finally {
    await sql.end()
  }
}
