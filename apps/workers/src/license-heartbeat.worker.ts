// Consumes: license.heartbeat queue. Runs on a 30-minute cadence (one job per
// tick; empty payload = audit every active clinic, or { clinicId } for one).
//
// THE ONE RULE: licensing NEVER interrupts a live clinic. This worker only
// *notifies* — it warns when a license is expiring (< 14 days) or has expired.
// It NEVER changes clinic status, so a running bot keeps working regardless of
// license state, an unparseable key, or a missing key.
import {
  dispatchNotification,
  NOTIFICATION_TYPES,
  type NotificationType,
} from '@docmee/notifications'
import {
  createServiceDbClient,
  createClinicsRepository,
  createNotificationsRepository,
  createUsersRepository,
  type Clinic,
  type NotificationsRepository,
} from '@docmee/db'
import type { Job } from '@docmee/queue'
import { buildNotificationStore } from './notification-store.js'

// A clinic's signed license key lives in clinics.settings under this key
// (mirrors LICENSE_SETTINGS_KEY in apps/licensekit/src/server.ts).
const LICENSE_SETTINGS_KEY = 'license_key'
const EXPIRING_WINDOW_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
// Suppress repeat alerts of the same type within this window (heartbeat ticks
// every 30 min; without this an expired clinic would alert ~48×/day).
const DEDUP_HOURS = 12

interface LicenseHeartbeatJobData {
  clinicId?: string
}

/** Decode the expiry from a stored license key. Trusted read (no signature check). */
function expiryFromKey(licenseKey: string): number | null {
  const [b64] = licenseKey.split('.')
  if (!b64) return null
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { expiresAt?: string }
    const ms = payload.expiresAt ? Date.parse(payload.expiresAt) : Number.NaN
    return Number.isNaN(ms) ? null : ms
  } catch {
    return null
  }
}

async function recentlyAlerted(
  notifications: NotificationsRepository,
  clinicId: string,
  type: NotificationType,
): Promise<boolean> {
  const cutoff = Date.now() - DEDUP_HOURS * 60 * 60 * 1000
  const recent = await notifications.listByClinic(clinicId, 50)
  return recent.some((n) => n.alertType === type && Date.parse(n.createdAt) > cutoff)
}

interface HeartbeatDeps {
  notifications: NotificationsRepository
  resolveRecipient: (clinicId: string) => Promise<string | null>
}

async function auditClinic(clinic: Clinic, deps: HeartbeatDeps): Promise<void> {
  const licenseKey = clinic.settings[LICENSE_SETTINGS_KEY]
  if (typeof licenseKey !== 'string' || !licenseKey) {
    console.warn(`[license-heartbeat] clinic ${clinic.id} has no license on file; clinic keeps running`)
    return
  }

  const expiresMs = expiryFromKey(licenseKey)
  if (expiresMs === null) {
    console.warn(`[license-heartbeat] clinic ${clinic.id} has an unparseable license; clinic keeps running`)
    return
  }

  const now = Date.now()
  const daysRemaining = Math.ceil((expiresMs - now) / DAY_MS)

  let type: NotificationType | null = null
  if (expiresMs <= now) {
    type = NOTIFICATION_TYPES.LICENSE_EXPIRED
  } else if (daysRemaining <= EXPIRING_WINDOW_DAYS) {
    type = NOTIFICATION_TYPES.LICENSE_EXPIRING
  }

  if (!type) {
    console.log(`[license-heartbeat] clinic ${clinic.id} license OK (${daysRemaining}d remaining)`)
    return
  }

  if (await recentlyAlerted(deps.notifications, clinic.id, type)) {
    return // already alerted within the dedup window
  }

  const recipientEmail = await deps.resolveRecipient(clinic.id)
  if (!recipientEmail) {
    console.warn(`[license-heartbeat] no recipient for clinic ${clinic.id}; logged ${type} but not delivered`)
    return
  }

  await dispatchNotification(
    {
      clinicId: clinic.id,
      type,
      data: {
        clinicName: clinic.name,
        expiresAt: new Date(expiresMs).toISOString(),
        daysRemaining: Math.max(0, daysRemaining),
      },
      recipientEmail,
    },
    { store: buildNotificationStore(deps.notifications) },
  )
  console.log(`[license-heartbeat] clinic ${clinic.id} → ${type} (${daysRemaining}d)`)
}

export async function processLicenseHeartbeatJob(job: Job): Promise<void> {
  const data = (job.data ?? {}) as LicenseHeartbeatJobData
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const clinics = createClinicsRepository(sql)
    const notifications = createNotificationsRepository(sql)
    const users = createUsersRepository(sql)

    const recipientCache = new Map<string, string | null>()
    const deps: HeartbeatDeps = {
      notifications,
      resolveRecipient: async (clinicId) => {
        if (!recipientCache.has(clinicId)) {
          const email =
            (await users.findPrimaryEmail(clinicId)) ?? process.env['ALERT_FALLBACK_EMAIL'] ?? null
          recipientCache.set(clinicId, email)
        }
        return recipientCache.get(clinicId) ?? null
      },
    }

    let targets: Clinic[]
    if (data.clinicId) {
      const clinic = await clinics.findById(data.clinicId)
      targets = clinic ? [clinic] : []
    } else {
      targets = (await clinics.list()).filter((c) => c.status === 'active')
    }

    for (const clinic of targets) {
      try {
        await auditClinic(clinic, deps)
      } catch (err) {
        // One clinic's failure must never abort the rest of the audit.
        console.error(
          `[license-heartbeat] audit failed for clinic ${clinic.id}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  } finally {
    await sql.end()
  }
}
