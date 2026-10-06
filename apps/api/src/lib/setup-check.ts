// Clinic setup check (server side): gathers the clinic facts, runs the pure
// checkClinicSetup() from @docmee/agents, and — after a configuration change —
// notifies clinic admins about problems that were not there before.
import {
  createChannelAccountsRepository,
  createClinicSetupChecksRepository,
  createClinicsRepository,
  createDoctorsRepository,
  createMessageTemplatesRepository,
  createNotificationsRepository,
  createWorkflowsRepository,
  normalizeWorkflowStatus,
  type Sql,
} from '@docmee/db'
import { checkClinicSetup, type LiveWorkflow, type SetupIssue, type WorkflowLintContext } from '@docmee/agents'
import { withDb } from './db.js'

function hasCalendarTokens(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record['accessToken'] === 'string' && typeof record['refreshToken'] === 'string'
}

/** Clinic facts the workflow lint needs. Read-only; a failed lookup just omits a fact. */
export async function workflowLintContext(sql: Sql, clinicId: string): Promise<WorkflowLintContext> {
  const [clinic, doctors, approved] = await Promise.all([
    createClinicsRepository(sql).findById(clinicId),
    createDoctorsRepository(sql).listByClinic(clinicId).catch(() => null),
    createMessageTemplatesRepository(sql).listApproved(clinicId).catch(() => null),
  ])
  return {
    ...(clinic && doctors
      ? { calendarConnected: hasCalendarTokens(clinic.settings['googleCalendar']) || doctors.some((doctor) => Boolean(doctor.googleCalendarRefreshTokenEncrypted)) }
      : {}),
    ...(doctors ? { doctorCount: doctors.length } : {}),
    ...(approved ? { approvedTemplateCategories: [...new Set(approved.map((template) => String(template.category)))] } : {}),
  }
}

/** Run the setup check for one clinic against its current settings and live workflows. */
export async function runSetupCheck(clinicId: string): Promise<SetupIssue[]> {
  return withDb(async (sql) => {
    const clinic = await createClinicsRepository(sql).findById(clinicId)
    if (!clinic) return []
    const workflows = createWorkflowsRepository(sql)
    const [accounts, all, lint] = await Promise.all([
      createChannelAccountsRepository(sql).listByClinic(clinicId),
      workflows.listByClinic(clinicId),
      workflowLintContext(sql, clinicId),
    ])
    const liveWorkflows: LiveWorkflow[] = []
    for (const workflow of all) {
      if (normalizeWorkflowStatus(workflow.status) !== 'published') continue
      // Lint what actually runs: the pinned active revision when there is one.
      const revision = workflow.activeRevisionId
        ? await workflows.findRevision(clinicId, workflow.id, workflow.activeRevisionId).catch(() => null)
        : null
      liveWorkflows.push({
        id: workflow.id,
        name: workflow.name,
        nodes: revision?.definition.nodes ?? workflow.nodes,
        edges: revision?.definition.edges ?? workflow.edges,
      })
    }
    const settings = clinic.settings as { businessHours?: unknown; automationDuringBusinessHours?: unknown }
    return checkClinicSetup({
      clinicId,
      businessHours: settings.businessHours && typeof settings.businessHours === 'object' ? (settings.businessHours as Record<string, unknown>) : null,
      automationDuringBusinessHours: settings.automationDuringBusinessHours === true,
      channelStatuses: accounts.map((account) => account.status),
      liveWorkflows,
      lint,
    })
  })
}

const MAX_NOTIFICATIONS_PER_CHECK = 5

/**
 * Re-run the check and notify about problems that are new since the last
 * snapshot. Returns the new issues. The snapshot is always refreshed, so a
 * fixed problem that comes back later notifies again.
 */
export async function recheckAndNotify(clinicId: string, actorEmail?: string | null): Promise<SetupIssue[]> {
  const issues = await runSetupCheck(clinicId)
  return withDb(async (sql) => {
    const snapshots = createClinicSetupChecksRepository(sql)
    const previous = await snapshots.get(clinicId)
    const known = new Set(previous?.issueKeys ?? [])
    const fresh = issues.filter((issue) => !known.has(issue.key))
    await snapshots.save(clinicId, issues.map((issue) => issue.key), issues)
    const notifications = createNotificationsRepository(sql)
    for (const issue of fresh.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) {
      await notifications.create({
        clinicId,
        notificationType: 'in_app',
        alertType: issue.severity === 'error' ? 'setup_error' : 'setup_warning',
        priority: issue.severity === 'error' ? 'p2' : 'standard',
        recipient: 'clinic_admins',
        subject: issue.title,
        content: `${issue.whatHappened} ${issue.howToFix}`,
        status: 'sent',
        metadata: {
          code: issue.code,
          key: issue.key,
          severity: issue.severity,
          href: issue.href,
          ...(issue.workflowId ? { workflowId: issue.workflowId } : {}),
          es: { subject: issue.translations.es.title, content: `${issue.translations.es.whatHappened} ${issue.translations.es.howToFix}` },
          ...(actorEmail ? { afterChangeBy: actorEmail } : {}),
        },
      })
    }
    return fresh
  })
}

// Several saves in a row (e.g. editing then publishing) re-check once.
const pending = new Map<string, ReturnType<typeof setTimeout>>()
export const SETUP_RECHECK_DELAY_MS = 2_000

export function scheduleSetupRecheck(clinicId: string, actorEmail: string | null, log: (message: string) => void): void {
  const existing = pending.get(clinicId)
  if (existing) clearTimeout(existing)
  pending.set(clinicId, setTimeout(() => {
    pending.delete(clinicId)
    recheckAndNotify(clinicId, actorEmail).catch((error: unknown) => {
      log(`[setup-check] recheck failed for clinic ${clinicId}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, SETUP_RECHECK_DELAY_MS))
}
