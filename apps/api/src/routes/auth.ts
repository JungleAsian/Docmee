// Auth routes (P08): login, refresh, logout.
//   POST /auth/login   { email, password }      → { accessToken, refreshToken, user }
//     user carries panelLanguage so the panel restores the saved ES/EN language on login.
//   POST /auth/refresh { refreshToken }          → { accessToken }
//   POST /auth/logout  { refreshToken }          → { success: true }
// Credentials are checked against clinic_users.password_hash (scrypt). Refresh
// tokens are revoked via the Redis blacklist on logout.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createClinicsRepository, createUsersRepository } from '@docmee/db'
import { hashPassword, verifyPassword } from '@docmee/shared'
import { normalizeNotificationPrefs } from '@docmee/notifications'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type JwtPayload,
} from '../auth/jwt.js'
import { blacklistRefreshToken, isRefreshTokenBlacklisted } from '../auth/token-store.js'
import { rateLimit } from '../lib/rate-limit.js'
import { containsSuspiciousText, hashAuditValue, logSecurityEvent } from '../lib/security-audit.js'

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60
// Brute-force guard: cap auth attempts per client IP. Generous enough for an office
// behind one NAT, far below what an automated guesser needs.
const AUTH_MAX_PER_MINUTE = 30
const LOGIN_EMAIL_MAX_PER_MINUTE = 12

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
})

const contactNumberSchema = z
  .string()
  .trim()
  .min(7)
  .max(24)
  .regex(/^[0-9+().\-\s]+$/, 'Use digits and standard phone punctuation only.')

function safeSignupText(minLength: number) {
  return z
    .string()
    .trim()
    .min(minLength)
    .max(80)
    .regex(/^[\p{L}\p{M}\p{N} .,'&()-]+$/u, 'Use letters, numbers, spaces, and basic punctuation only.')
    .refine(
      (value) =>
        !/(ignore previous|system prompt|developer message|jailbreak|prompt injection|act as|you are chatgpt|assistant:|system:|user:|<script|```)/i.test(
          value,
        ),
      'This text is not allowed.',
    )
}

const signupSchema = z.object({
  clinicName: safeSignupText(2),
  fullName: safeSignupText(1),
  email: z.string().trim().email().max(254),
  contactNumber: contactNumberSchema,
})
const refreshSchema = z.object({ refreshToken: z.string().min(1) })
const logoutSchema = z.object({ refreshToken: z.string().min(1) })

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'clinic'
}

async function uniqueClinicSlug(sql: Parameters<Parameters<typeof withDb>[0]>[0], name: string): Promise<string> {
  const repo = createClinicsRepository(sql)
  const base = slugify(name)
  let candidate = base
  for (let index = 2; await repo.findBySlug(candidate); index += 1) {
    candidate = `${base}-${index}`
  }
  return candidate
}

const authRoute: FastifyPluginAsync = async (app) => {
  // Rate-limit every auth endpoint by client IP to blunt credential stuffing /
  // brute-force (no app-level limiting existed; fail2ban only covers SSH).
  app.addHook('onRequest', async (request, reply) => {
    const { ok, retryAfter } = rateLimit(`auth:${request.ip}`, AUTH_MAX_PER_MINUTE, 60_000)
    if (!ok) {
      logSecurityEvent(request, 'auth.rate_limited', { retryAfter })
      reply.header('retry-after', String(retryAfter))
      return reply.code(429).send({ error: 'Too many requests — slow down.' })
    }
  })

  app.post('/login', async (request, reply) => {
    if (containsSuspiciousText(request.body)) {
      logSecurityEvent(request, 'auth.login_suspicious_payload')
    }
    const parsed = validate(loginSchema, request.body, reply)
    if (!parsed.ok) return
    const { email, password } = parsed.data
    const emailHash = hashAuditValue(email)
    const emailLimit = rateLimit(`auth:login-email:${email.toLowerCase()}`, LOGIN_EMAIL_MAX_PER_MINUTE, 60_000)
    if (!emailLimit.ok) {
      logSecurityEvent(request, 'auth.login_email_rate_limited', {
        emailHash,
        retryAfter: emailLimit.retryAfter,
      })
      reply.header('retry-after', String(emailLimit.retryAfter))
      return reply.code(429).send({ error: 'Too many requests — slow down.' })
    }

    const auth = await withDb(async (sql) => createUsersRepository(sql).findAuthByEmail(email))

    // Same response for unknown user / inactive / bad password — no account enumeration.
    if (!auth || auth.status !== 'active' || !auth.passwordHash || !verifyPassword(password, auth.passwordHash)) {
      logSecurityEvent(request, 'auth.login_failed', { emailHash })
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    const notificationPrefs = await withDb(async (sql) =>
      createUsersRepository(sql).getNotificationPrefs(auth.clinicId, auth.id),
    )
    const normalizedPrefs = normalizeNotificationPrefs(notificationPrefs ?? {})

    const payload: JwtPayload = {
      userId: auth.id,
      accountUserId: auth.accountUserId,
      clinicId: auth.clinicId,
      role: auth.role,
      email: auth.email,
      permissions: auth.permissions,
      clinicIds: auth.accessibleClinicIds,
      isGlobalSuperAdmin: auth.isGlobalSuperAdmin,
    }
    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: {
        id: auth.id,
        email: auth.email,
        fullName: auth.fullName,
        role: auth.role,
        clinicId: auth.clinicId,
        accountUserId: auth.accountUserId,
        permissions: auth.permissions,
        clinicIds: auth.accessibleClinicIds,
        isGlobalSuperAdmin: auth.isGlobalSuperAdmin,
        panelLanguage: auth.panelLanguage,
        inactivityTimeoutMinutes: auth.inactivityTimeoutMinutes,
        jzelEnabled: normalizedPrefs.jzelEnabled,
      },
    }
  })

  app.post('/signup', async (request, reply) => {
    if (containsSuspiciousText(request.body)) {
      logSecurityEvent(request, 'auth.signup_suspicious_payload')
    }
    const parsed = validate(signupSchema, request.body, reply)
    if (!parsed.ok) return
    const { clinicName, fullName, email, contactNumber } = parsed.data
    const result = await withDb(async (sql) => {
      const existingUser = await createUsersRepository(sql).findAuthByEmail(email)
      if (existingUser) return { conflict: true as const }
      const existingRequest = await sql<{ id: string }[]>`
        SELECT id FROM signup_requests
        WHERE LOWER(email) = LOWER(${email}) AND status = 'pending'
        LIMIT 1
      `
      if (existingRequest[0]) return { pending: true as const }
      const rows = await sql<{ id: string }[]>`
        INSERT INTO signup_requests (clinic_name, full_name, email, password_hash, status)
        VALUES (${clinicName}, ${fullName}, ${email}, ${hashPassword(contactNumber)}, 'pending')
        RETURNING id
      `
      return { id: rows[0]!.id }
    })
    if ('conflict' in result) return reply.code(409).send({ error: 'An account already exists for this email.' })
    if ('pending' in result) return reply.code(409).send({ error: 'A signup request is already pending for this email.' })
    return reply.code(202).send({ ok: true, requestId: result.id })
  })

  app.get('/signup-requests', { preHandler: [requireAuth, requireRole('ia_studio_admin')] }, async () => {
    const requests = await withDb(async (sql) => sql`
      SELECT id, clinic_name, full_name, email, status, reviewed_by, reviewed_at, created_at, updated_at
      FROM signup_requests
      ORDER BY created_at DESC
    `)
    return { requests }
  })

  app.post<{ Params: { id: string } }>(
    '/signup-requests/:id/approve',
    { preHandler: [requireAuth, requireRole('ia_studio_admin')] },
    async (request, reply) => {
      const result = await withDb(async (sql) => {
        return sql.begin(async (tx) => {
          const requests = await tx<{
            id: string
            clinicName: string
            fullName: string
            email: string
            passwordHash: string
            status: string
          }[]>`
            SELECT id, clinic_name, full_name, email, password_hash, status
            FROM signup_requests
            WHERE id = ${request.params.id}
            FOR UPDATE
          `
          const signup = requests[0]
          if (!signup) return { notFound: true as const }
          if (signup.status !== 'pending') return { notPending: true as const }
          const txSql = tx as unknown as Parameters<typeof createUsersRepository>[0]
          if (await createUsersRepository(txSql).findAuthByEmail(signup.email)) return { conflict: true as const }
          const clinics = createClinicsRepository(txSql)
          const slug = await uniqueClinicSlug(txSql, signup.clinicName)
          const clinic = await clinics.create({
            name: signup.clinicName,
            slug,
            plan: 'starter',
            status: 'active',
            settings: { signupRequestId: signup.id },
          })
          const users = createUsersRepository(txSql)
          const user = await users.create({
            clinicId: clinic.id,
            email: signup.email,
            fullName: signup.fullName,
            status: 'active',
            passwordHash: signup.passwordHash,
            panelLanguage: 'en',
          })
          await users.setRole(clinic.id, user.id, 'clinic_admin')
          await tx`
            UPDATE signup_requests
            SET status = 'approved', reviewed_by = ${request.user!.email}, reviewed_at = NOW(), updated_at = NOW()
            WHERE id = ${signup.id}
          `
          return { clinic, user }
        })
      })
      if ('notFound' in result) return reply.code(404).send({ error: 'Signup request not found' })
      if ('notPending' in result) return reply.code(409).send({ error: 'Signup request is not pending' })
      if ('conflict' in result) return reply.code(409).send({ error: 'An account already exists for this email' })
      return reply.code(201).send({ ok: true, clinic: result.clinic, user: { id: result.user.id, email: result.user.email } })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/signup-requests/:id/reject',
    { preHandler: [requireAuth, requireRole('ia_studio_admin')] },
    async (request, reply) => {
      const rows = await withDb(async (sql) => sql<{ id: string }[]>`
        UPDATE signup_requests
        SET status = 'rejected', reviewed_by = ${request.user!.email}, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ${request.params.id} AND status = 'pending'
        RETURNING id
      `)
      if (!rows[0]) return reply.code(404).send({ error: 'Pending signup request not found' })
      return { ok: true }
    },
  )

  app.post('/refresh', async (request, reply) => {
    const parsed = validate(refreshSchema, request.body, reply)
    if (!parsed.ok) return
    const { refreshToken } = parsed.data

    if (await isRefreshTokenBlacklisted(refreshToken)) {
      return reply.code(401).send({ error: 'Invalid token' })
    }
    let payload: JwtPayload
    try {
      payload = verifyRefreshToken(refreshToken)
    } catch {
      return reply.code(401).send({ error: 'Invalid token' })
    }
    // Rotation: invalidate the presented refresh token and issue a fresh pair, so a
    // stolen token is single-use — its replay after the legitimate refresh is rejected.
    await blacklistRefreshToken(refreshToken, REFRESH_TTL_SECONDS)
    const next: JwtPayload = {
      userId: payload.userId,
      accountUserId: payload.accountUserId,
      clinicId: payload.clinicId,
      role: payload.role,
      email: payload.email,
      permissions: payload.permissions,
      clinicIds: payload.clinicIds,
      isGlobalSuperAdmin: payload.isGlobalSuperAdmin,
    }
    return { accessToken: signAccessToken(next), refreshToken: signRefreshToken(next) }
  })

  app.post('/logout', async (request, reply) => {
    const parsed = validate(logoutSchema, request.body, reply)
    if (!parsed.ok) return
    // Idempotent: revoke whatever was supplied; a malformed token is simply a no-op.
    try {
      verifyRefreshToken(parsed.data.refreshToken)
      await blacklistRefreshToken(parsed.data.refreshToken, REFRESH_TTL_SECONDS)
    } catch {
      // ignore invalid/expired tokens
    }
    return { success: true }
  })
}

export default authRoute
