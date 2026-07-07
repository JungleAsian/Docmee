
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createClinicsRepository, type Clinic } from '@docmee/db'
import { decryptValue, encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { validate } from '../lib/validate.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { providerDefaults, publicEmailSettings, sendSmtpEmail, type EmailDeliveryProvider, type EmailDeliveryStoredSettings } from '../lib/email-delivery.js'

const providerSchema = z.enum(['google', 'outlook', 'other'])
const saveSchema = z.object({
  enabled: z.boolean().optional(),
  provider: providerSchema.default('google'),
  fromName: z.string().trim().min(1).optional(),
  fromEmail: z.string().trim().email().optional().or(z.literal('')),
  replyTo: z.string().trim().email().optional().or(z.literal('')),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().optional(),
  smtpPassword: z.string().optional(),
  notes: z.string().trim().optional(),
})
const testSchema = z.object({
  to: z.string().trim().email().optional(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function currentEmailSettings(clinic: Clinic): EmailDeliveryStoredSettings {
  const settings = isRecord(clinic.settings) ? clinic.settings : {}
  const email = settings['emailDelivery']
  return isRecord(email) ? { ...(email as EmailDeliveryStoredSettings) } : {}
}

function normalizeProvider(value: unknown): EmailDeliveryProvider {
  return value === 'outlook' || value === 'other' ? value : 'google'
}

function mergeEmailSettings(current: EmailDeliveryStoredSettings, input: z.infer<typeof saveSchema>): EmailDeliveryStoredSettings {
  const provider = input.provider ?? normalizeProvider(current.provider)
  const defaults = providerDefaults(provider)
  const next: EmailDeliveryStoredSettings = {
    ...current,
    provider,
    enabled: input.enabled ?? current.enabled ?? false,
    fromName: input.fromName ?? current.fromName ?? 'Docmee',
    fromEmail: input.fromEmail ?? current.fromEmail ?? '',
    replyTo: input.replyTo ?? current.replyTo ?? '',
    smtpHost: input.smtpHost ?? current.smtpHost ?? defaults.smtpHost,
    smtpPort: input.smtpPort ?? current.smtpPort ?? defaults.smtpPort,
    smtpSecure: input.smtpSecure ?? current.smtpSecure ?? defaults.smtpSecure,
    smtpUser: input.smtpUser ?? current.smtpUser ?? '',
    notes: input.notes ?? current.notes ?? '',
  }
  if (input.smtpPassword && input.smtpPassword.trim()) {
    next.smtpPasswordEnc = encryptValue(input.smtpPassword.trim())
  }
  if (provider !== 'other') {
    next.smtpHost = defaults.smtpHost
    next.smtpPort = defaults.smtpPort
    next.smtpSecure = defaults.smtpSecure
  }
  return next
}

function missingForSend(config: EmailDeliveryStoredSettings): string[] {
  const missing: string[] = []
  if (!config.enabled) missing.push('Enable outbound email')
  if (!config.fromEmail) missing.push('From email')
  if (!config.smtpHost) missing.push('SMTP host')
  if (!config.smtpPort) missing.push('SMTP port')
  if (!config.smtpUser) missing.push('SMTP username')
  if (!config.smtpPasswordEnc) missing.push('SMTP password or app password')
  return missing
}

function settingsRoot(clinic: Clinic): Record<string, unknown> {
  return isRecord(clinic.settings) ? { ...(clinic.settings as Record<string, unknown>) } : {}
}

const emailDeliveryRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/email-delivery', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
    if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
    const config = currentEmailSettings(clinic)
    return { emailDelivery: publicEmailSettings(config), missing: missingForSend(config) }
  })

  app.patch<{ Params: { id: string } }>('/clinics/:id/email-delivery', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(saveSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const updated = await withDb(async (sql) => {
      const repo = createClinicsRepository(sql)
      const clinic = await repo.findById(clinicId)
      if (!clinic) return null
      const root = settingsRoot(clinic)
      const current = currentEmailSettings(clinic)
      const emailDelivery = mergeEmailSettings(current, parsed.data)
      return repo.update(clinicId, { settings: { ...root, emailDelivery } })
    })
    if (!updated) return reply.code(404).send({ error: 'Clinic not found' })
    const config = currentEmailSettings(updated)
    return { emailDelivery: publicEmailSettings(config), missing: missingForSend(config) }
  })

  app.delete<{ Params: { id: string } }>('/clinics/:id/email-delivery', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const updated = await withDb(async (sql) => {
      const repo = createClinicsRepository(sql)
      const clinic = await repo.findById(clinicId)
      if (!clinic) return null
      const root = settingsRoot(clinic)
      delete root['emailDelivery']
      return repo.update(clinicId, { settings: root })
    })
    if (!updated) return reply.code(404).send({ error: 'Clinic not found' })
    return { emailDelivery: {}, missing: ['Enable outbound email', 'From email', 'SMTP host', 'SMTP port', 'SMTP username', 'SMTP password or app password'] }
  })

  app.post<{ Params: { id: string } }>('/clinics/:id/email-delivery/test', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(testSchema, request.body ?? {}, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const result = await withDb(async (sql) => {
      const repo = createClinicsRepository(sql)
      const clinic = await repo.findById(clinicId)
      if (!clinic) return { code: 404 as const }
      const config = currentEmailSettings(clinic)
      const missing = missingForSend(config)
      if (missing.length) return { code: 400 as const, missing }
      const password = decryptValue(config.smtpPasswordEnc!)
      const to = parsed.data.to || config.replyTo || request.user?.email || config.fromEmail!
      await sendSmtpEmail({
        host: config.smtpHost!,
        port: config.smtpPort!,
        secure: Boolean(config.smtpSecure),
        username: config.smtpUser!,
        password,
        fromName: config.fromName || clinic.name || 'Docmee',
        fromEmail: config.fromEmail!,
        replyTo: config.replyTo || undefined,
        to,
        subject: 'Docmee email delivery test',
        text: `Docmee email delivery is configured for ${clinic.name}.\n\nProvider: ${config.provider ?? 'google'}\nSent at: ${new Date().toISOString()}\n`,
      })
      const root = settingsRoot(clinic)
      const emailDelivery = { ...config, lastTestAt: new Date().toISOString(), lastTestTo: to }
      await repo.update(clinicId, { settings: { ...root, emailDelivery } })
      return { code: 200 as const, to, emailDelivery }
    })
    if (result.code === 404) return reply.code(404).send({ error: 'Clinic not found' })
    if (result.code === 400) return reply.code(400).send({ error: 'Email delivery is not ready', missing: result.missing })
    return { ok: true, sentTo: result.to, emailDelivery: publicEmailSettings(result.emailDelivery) }
  })
}

export default emailDeliveryRoute
