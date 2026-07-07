import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { parseEnv } from './plugins/env.js'
import { errorHandler, notFoundHandler } from './plugins/errors.js'
import { closeDb } from './lib/db.js'
import healthRoute from './routes/health.js'
import configRoute from './routes/config.js'
import webhookRoute from './routes/webhook.js'
import messengerRoute from './routes/messenger.js'
import instagramRoute from './routes/instagram.js'
import authRoute from './routes/auth.js'
import clinicsRoute from './routes/clinics.js'
import conversationsRoute from './routes/conversations.js'
import conversationMediaRoute from './routes/conversation-media.js'
import assistantRoute from './routes/assistant.js'
import jzelRoute from './routes/jzel.js'
import patientsRoute from './routes/patients.js'
import kbRoute from './routes/kb.js'
import notificationsRoute from './routes/notifications.js'
import calendarRoute from './routes/calendar.js'
import userRoute from './routes/user.js'
import usersRoute from './routes/users.js'
import errorsRoute from './routes/errors.js'
import usageRoute from './routes/usage.js'
import licenseRoute from './routes/license.js'
import quickRepliesRoute from './routes/quick-replies.js'
import metricsRoute from './routes/metrics.js'
import templatesRoute from './routes/templates.js'
import doctorsRoute from './routes/doctors.js'
import servicesRoute from './routes/services.js'
import appointmentsRoute from './routes/appointments.js'
import customFlowsRoute from './routes/custom-flows.js'
import followUpsRoute from './routes/follow-ups.js'
import workflowsRoute from './routes/workflows.js'
import kbUploadRoute from './routes/kb-upload.js'
import analyticsRoute from './routes/analytics.js'
import qosRoute from './routes/qos.js'
import reportsRoute from './routes/reports.js'
import reviewsRoute from './routes/reviews.js'
import waitlistRoute from './routes/waitlist.js'
import channelsRoute from './routes/channels.js'
import providerStatusRoute from './routes/provider-status.js'
import providerRecoveryRoute from './routes/provider-recovery.js'
import aiCredentialsRoute from './routes/ai-credentials.js'
import launchReadinessRoute from './routes/launch-readiness.js'
import governanceRoute from './routes/governance.js'
import credentialHealthRoute from './routes/credential-health.js'
import emailDeliveryRoute from './routes/email-delivery.js'

export async function buildApp() {
  const env = parseEnv()

  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    // Behind Caddy/ngrok — read the real client IP from X-Forwarded-For so the
    // auth rate limiter buckets per client, not per proxy (which is 127.0.0.1).
    trustProxy: true,
    // CRE-58: request correlation — honor an inbound x-request-id (proxy/caller) or
    // generate one. Fastify then stamps request.id on every log line as reqId.
    requestIdHeader: 'x-request-id',
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  })

  app.addHook('onRequest', async (request, reply) => {
    // CRE-58: echo the correlation id so clients / log aggregators can trace a request.
    reply.header('x-request-id', request.id)
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex')
    reply.header('x-permitted-cross-domain-policies', 'none')
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    reply.header('cross-origin-opener-policy', 'same-origin')
    reply.header('cross-origin-resource-policy', 'same-origin')
    reply.header('cache-control', 'no-store')
    const origin = request.headers.origin
    const defaultCorsOrigins =
      env.NODE_ENV === 'production'
        ? 'https://app.docmeedevelopment.dev'
        : 'http://localhost:3000,http://127.0.0.1:3000'
    const allowedOrigins = (process.env['CORS_ORIGINS'] ?? defaultCorsOrigins)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    // The Tailscale CGNAT reflection is a dev convenience (panel runs on 100.x).
    // In production only the explicit CORS_ORIGINS allowlist (https domains) is
    // trusted — don't reflect arbitrary http Tailscale origins.
    const tailscaleDevOrigin = env.NODE_ENV !== 'production' && /^http:\/\/100\.\d{1,3}\.\d{1,3}\.\d{1,3}:3000$/.test(origin ?? '')
    const isAllowed = origin && (allowedOrigins.includes(origin) || tailscaleDevOrigin)
    if (isAllowed) reply.header('access-control-allow-origin', origin)
    reply.header('vary', 'Origin')
    reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    // x-clinic-id carries the panel's active clinic (Screen 6 — clinic switching).
    reply.header('access-control-allow-headers', 'content-type,authorization,x-clinic-id,x-request-id')
    reply.header('access-control-expose-headers', 'x-request-id')
    if (request.method === 'OPTIONS') {
      return reply.status(204).send()
    }
  })

  app.setErrorHandler(errorHandler)
  app.setNotFoundHandler(notFoundHandler)
  // CRE-57: close the shared pooled DB client when the server shuts down (CRE-55).
  app.addHook('onClose', async () => {
    await closeDb()
  })

  await app.register(healthRoute)
  await app.register(configRoute)
  await app.register(authRoute, { prefix: '/auth' })
  await app.register(webhookRoute, { prefix: '/webhook' })
  await app.register(messengerRoute, { prefix: '/webhook' })
  await app.register(instagramRoute, { prefix: '/webhook' })
  await app.register(clinicsRoute, { prefix: '/clinics' })
  await app.register(channelsRoute)
  await app.register(providerStatusRoute)
  await app.register(providerRecoveryRoute)
  // Per-clinic AI provider credentials (declares its own /clinic/:id/ai/… paths)
  await app.register(aiCredentialsRoute)
  await app.register(launchReadinessRoute)
  await app.register(governanceRoute)
  await app.register(credentialHealthRoute)
  await app.register(emailDeliveryRoute)
  await app.register(conversationsRoute, { prefix: '/conversations' })
  // Outbound image attachment (Req 3) — separate plugin so @fastify/multipart is
  // encapsulated and never affects the JSON conversation routes. Declares its own
  // /conversations/:id/send-media path.
  await app.register(conversationMediaRoute)
  // Internal AI Assistant for secretaries (Req 41) — staff-only summary/suggestions.
  await app.register(assistantRoute, { prefix: '/conversations' })
  // J.zel interactive chat — POST /assist/chat
  await app.register(jzelRoute, { prefix: '/assist' })
  // patients + kb declare their own /clinics/:id/… and /patients/… paths.
  await app.register(patientsRoute)
  await app.register(kbRoute)
  // errors declares its own /clinics/:id/errors… paths
  await app.register(errorsRoute)
  // usage + license declare their own /clinics/:id/… and /usage/… paths
  await app.register(usageRoute)
  await app.register(licenseRoute)
  // quick replies, metrics + message templates declare their own /clinics/:id/… paths
  await app.register(quickRepliesRoute)
  await app.register(metricsRoute)
  await app.register(templatesRoute)
  // P18 — Phase 3 routes. doctors/custom-flows/kb-upload/analytics declare their own
  // /clinics/:id/… paths; reviews exposes the public /r/:id review redirector.
  await app.register(doctorsRoute)
  await app.register(servicesRoute)
  // Screen 2 — operational booking calendar (declares its own /clinics/:id/… paths)
  await app.register(appointmentsRoute)
  await app.register(customFlowsRoute)
  await app.register(followUpsRoute)
  await app.register(workflowsRoute)
  await app.register(kbUploadRoute)
  await app.register(analyticsRoute)
  await app.register(qosRoute)
  await app.register(reportsRoute)
  await app.register(reviewsRoute)
  await app.register(waitlistRoute)
  await app.register(notificationsRoute, { prefix: '/notifications' })
  await app.register(calendarRoute)
  await app.register(userRoute, { prefix: '/user' })
  await app.register(usersRoute)

  return app
}
