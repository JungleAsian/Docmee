import type { FastifyPluginAsync } from 'fastify'
import { hasDatabaseUrl, withDb } from '../lib/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

type CredentialState = 'pass' | 'warning' | 'fail' | 'manual'
type RotationMode = 'monitor' | 'guide' | 'validate' | 'audit'

interface CredentialItem {
  key: string
  label: string
  category: string
  state: CredentialState
  configured: boolean
  lastObservedAt: string | null
  recommendedFrequency: string
  owner: string
  validation: string
  guidance: string
  rotationMode: RotationMode[]
  manualOnly?: boolean
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function envGroup(names: string[]): { configured: boolean; missing: string[] } {
  const missing = names.filter((name) => !hasEnv(name))
  return { configured: missing.length === 0, missing }
}

function item(input: Omit<CredentialItem, 'state'> & { state?: CredentialState }): CredentialItem {
  return {
    ...input,
    state:
      input.state ??
      (input.configured ? 'pass' : input.manualOnly ? 'manual' : 'fail'),
  }
}

const credentialHealthRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get('/credential-health', { preHandler: requireRole('ia_studio_admin') }, async () => {
    const checkedAt = new Date().toISOString()
    const metaEnv = envGroup(['META_APP_ID', 'META_EMBEDDED_SIGNUP_CONFIG_ID', 'META_APP_SECRET'])
    const googleEnv = envGroup(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'])
    const kbEnv = envGroup(['DOCMEE_KB_GIT_REPO', 'DOCMEE_KB_WORKDIR', 'DOCMEE_KB_WEBHOOK_SECRET'])
    const kbDeployKeyConfigured = hasEnv('DOCMEE_KB_DEPLOY_KEY_PATH') || hasEnv('DOCMEE_KB_DEPLOY_KEY')
    const llmConfigured = hasEnv('OPENAI_API_KEY') || hasEnv('ANTHROPIC_API_KEY')
    const jwtEnv = envGroup(['JWT_SECRET', 'JWT_REFRESH_SECRET'])
    const weakJwt =
      process.env['JWT_SECRET'] === 'dev-access-secret-change-me' ||
      process.env['JWT_REFRESH_SECRET'] === 'dev-refresh-secret-change-me' ||
      process.env['JWT_SECRET'] === process.env['JWT_REFRESH_SECRET']

    let activeWhatsAppUpdatedAt: string | null = null
    let hasActiveWhatsAppToken = false
    let hasActiveWhatsAppVerifyToken = false
    let activeWhatsAppDisplay = 'No active WhatsApp account was found.'
    let googleConnectedDoctors = 0
    let googleDoctorCount = 0
    let dbReachable = false
    let dbError: string | null = null

    if (hasDatabaseUrl()) {
      try {
        await withDb(async (sql) => {
          await sql`SELECT 1`
          dbReachable = true
          const whatsappRows = await sql<Array<{
            account_id: string
            display_name: string | null
            access_token_enc: string | null
            webhook_verify_token: string | null
            updated_at: string
          }>>`
            SELECT account_id, display_name, access_token_enc, webhook_verify_token, updated_at
            FROM channel_accounts
            WHERE channel = 'whatsapp' AND status = 'active'
            ORDER BY updated_at DESC
            LIMIT 1
          `
          const active = whatsappRows[0]
          if (active) {
            activeWhatsAppUpdatedAt = active.updated_at
            hasActiveWhatsAppToken = Boolean(active.access_token_enc)
            hasActiveWhatsAppVerifyToken = Boolean(active.webhook_verify_token)
            activeWhatsAppDisplay = `${active.display_name ?? 'WhatsApp'} (${active.account_id})`
          }

          try {
            const doctorRows = await sql<Array<{ total: string; connected: string }>>`
              SELECT
                count(*)::text AS total,
                count(*) FILTER (WHERE google_refresh_token_enc IS NOT NULL)::text AS connected
              FROM doctors
              WHERE status = 'active'
            `
            googleDoctorCount = Number(doctorRows[0]?.total ?? 0)
            googleConnectedDoctors = Number(doctorRows[0]?.connected ?? 0)
          } catch {
            googleDoctorCount = 0
            googleConnectedDoctors = 0
          }
        })
      } catch (error) {
        dbError = error instanceof Error ? error.message : 'Database check failed'
      }
    }

    const credentials: CredentialItem[] = [
      item({
        key: 'database',
        label: 'Database connection',
        category: 'Core platform',
        configured: hasEnv('DATABASE_URL') && dbReachable,
        state: !hasEnv('DATABASE_URL') ? 'fail' : dbReachable ? 'pass' : 'warning',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Rotate password every 6-12 months or after access changes.',
        owner: 'Platform operations',
        validation: dbReachable ? 'Docmee reached the database successfully.' : dbError ?? 'DATABASE_URL is missing or unreachable.',
        guidance: 'Rotate outside the web app, update the server environment, restart services, then validate login and core pages.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
        manualOnly: true,
      }),
      item({
        key: 'app-encryption-key',
        label: 'Application encryption key',
        category: 'Core platform',
        configured: hasEnv('ENCRYPTION_KEY'),
        state: hasEnv('ENCRYPTION_KEY') ? 'warning' : 'fail',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Emergency or planned rewrap only; do not rotate routinely.',
        owner: 'Platform operations',
        validation: hasEnv('ENCRYPTION_KEY')
          ? 'ENCRYPTION_KEY is present. Rotation requires re-encrypting stored provider tokens.'
          : 'ENCRYPTION_KEY is missing; encrypted provider tokens cannot be saved or read safely.',
        guidance: 'Use a separate re-encryption runbook. Back up the database, rewrap encrypted token columns, then restart and validate providers.',
        rotationMode: ['monitor', 'guide', 'audit'],
        manualOnly: true,
      }),
      item({
        key: 'jwt-secrets',
        label: 'JWT access and refresh secrets',
        category: 'Core platform',
        configured: jwtEnv.configured && !weakJwt,
        state: jwtEnv.configured && !weakJwt ? 'pass' : 'fail',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Every 6-12 months or after suspected exposure.',
        owner: 'Platform operations',
        validation: jwtEnv.configured && !weakJwt ? 'JWT secrets are present and not using development defaults.' : `Needs attention: ${jwtEnv.missing.concat(weakJwt ? ['weak/default JWT secret'] : []).join(', ')}.`,
        guidance: 'Rotate during a maintenance window because active sessions will be invalidated.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
        manualOnly: true,
      }),
      item({
        key: 'meta-whatsapp',
        label: 'Meta WhatsApp Cloud API',
        category: 'Messaging',
        configured: metaEnv.configured && hasActiveWhatsAppToken && hasActiveWhatsAppVerifyToken,
        state: metaEnv.configured && hasActiveWhatsAppToken && hasActiveWhatsAppVerifyToken ? 'pass' : 'warning',
        lastObservedAt: activeWhatsAppUpdatedAt,
        recommendedFrequency: 'Review every 6 months; rotate immediately after staff/vendor access changes.',
        owner: 'Superuser / Meta business admin',
        validation: `${activeWhatsAppDisplay}. ${metaEnv.missing.length ? `Missing ${metaEnv.missing.join(', ')}. ` : ''}${hasActiveWhatsAppToken ? 'Access token stored. ' : 'No active access token. '}${hasActiveWhatsAppVerifyToken ? 'Webhook verify token stored.' : 'Webhook verify token missing.'}`,
        guidance: 'Use Meta Business/Developer tools to rotate app secrets and system-user tokens, then update Docmee and run webhook/send tests.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
      }),
      item({
        key: 'google-calendar',
        label: 'Google Calendar OAuth',
        category: 'Scheduling',
        configured: googleEnv.configured,
        state: googleEnv.configured && (googleDoctorCount === 0 || googleConnectedDoctors > 0) ? 'pass' : 'warning',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Review every 6-12 months; rotate after Google project/user access changes.',
        owner: 'Superuser / Google Cloud admin',
        validation: googleEnv.configured
          ? `${googleConnectedDoctors} of ${googleDoctorCount} active doctors have calendar credentials.`
          : `Missing ${googleEnv.missing.join(', ')}.`,
        guidance: 'Update OAuth client secrets outside the app, then re-test calendar connection and reconnect doctors if Google invalidates refresh tokens.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
      }),
      item({
        key: 'github-kb',
        label: 'GitHub Knowledge Base sync',
        category: 'Knowledge base',
        configured: kbEnv.configured && kbDeployKeyConfigured,
        state: kbEnv.configured && kbDeployKeyConfigured ? 'pass' : 'warning',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Review every 6-12 months; rotate webhook/deploy keys after machine or maintainer changes.',
        owner: 'Superuser / GitHub repository admin',
        validation: kbEnv.configured && kbDeployKeyConfigured
          ? 'KB repository, workdir, deploy key, and webhook secret are configured.'
          : `Missing ${kbEnv.missing.concat(kbDeployKeyConfigured ? [] : ['DOCMEE_KB_DEPLOY_KEY_PATH or DOCMEE_KB_DEPLOY_KEY']).join(', ')}.`,
        guidance: 'Rotate the GitHub deploy key and webhook secret in GitHub and Docmee together, then push a small KB update to validate sync.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
      }),
      item({
        key: 'ai-provider',
        label: 'AI provider keys',
        category: 'AI services',
        configured: llmConfigured,
        state: llmConfigured ? 'pass' : 'warning',
        lastObservedAt: checkedAt,
        recommendedFrequency: 'Every 90 days for manually managed provider keys, or immediately after exposure.',
        owner: 'Superuser / clinic AI admin',
        validation: llmConfigured ? 'At least one server-level AI provider key is configured.' : 'No server-level OpenAI or Anthropic key was detected.',
        guidance: 'Prefer per-clinic provider credentials where possible. Re-enter rotated keys, then run the J.zel provider/KB readiness test.',
        rotationMode: ['monitor', 'guide', 'validate', 'audit'],
      }),
      item({
        key: 'aws-ssh',
        label: 'AWS / SSH access keys',
        category: 'Infrastructure',
        configured: true,
        state: 'manual',
        lastObservedAt: null,
        recommendedFrequency: 'SSH keys every 6-12 months; IAM long-lived keys every 90 days or replace with roles.',
        owner: 'Platform operations',
        validation: 'Manual-only: Docmee should not hold enough authority to rotate its own infrastructure access.',
        guidance: 'Add the new key first, test access, update runbooks, then remove the old key. Keep this outside the web app.',
        rotationMode: ['guide', 'audit'],
        manualOnly: true,
      }),
    ]

    const summary = {
      pass: credentials.filter((entry) => entry.state === 'pass').length,
      warning: credentials.filter((entry) => entry.state === 'warning').length,
      fail: credentials.filter((entry) => entry.state === 'fail').length,
      manual: credentials.filter((entry) => entry.state === 'manual').length,
      total: credentials.length,
    }

    return {
      checkedAt,
      visibility: 'superuser_only',
      summary,
      credentials,
      audit: {
        principle: 'Docmee monitors, guides, validates, and audits. Critical rotation remains manual or external.',
        lastCheckedAt: checkedAt,
        recordsStored: 'No secret values are returned or stored by this endpoint.',
      },
    }
  })
}

export default credentialHealthRoute
