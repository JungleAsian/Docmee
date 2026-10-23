import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { resolveLayaControls } from '@docmee/agents'
import { createLayaControlsRepository } from '@docmee/db'
import type { LayaDiagnosticStatus, LayaDiagnosticTest } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

// Diagnostics may only reach the installed, isolated same-server runtime.
// Neither a browser parameter nor an environment override can change this destination.
const runtime = 'http://127.0.0.1:8767'
const paramsSchema = z.object({ clinicId: z.string().uuid() })
const testSchema = z.object({ language: z.enum(['en', 'es']) }).strict()
const decisionSchema = z.object({
  schemaVersion: z.literal(1), requestId: z.string().uuid(),
  modelVersion: z.string().min(1).max(200), calibrationVersion: z.string().min(1).max(200),
  choiceId: z.enum(['book', 'hours']).nullable(), rawScore: z.number().finite().min(0).max(1),
  abstain: z.boolean(),
}).strict()

/** Bound headers AND streamed body, reject redirects, and never propagate upstream text. */
async function runtimeJson(path: string, timeoutMs: number, body?: unknown): Promise<
  { kind: 'json'; value: unknown } | { kind: 'timeout' | 'unavailable' | 'invalid_response' }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${runtime}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return { kind: 'unavailable' }
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) {
      await response.body?.cancel()
      return { kind: 'invalid_response' }
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8192) {
          await reader.cancel()
          return { kind: 'invalid_response' }
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    return { kind: 'json', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  } catch (error) {
    return { kind: controller.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'invalid_response' : 'unavailable' }
  } finally { clearTimeout(timer) }
}

const layaDiagnosticsRoute: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)
  // Shared by all clinics/operators in this API process, not one limiter per clinic.
  let running = false
  let nextTestAt = 0

  app.get('/clinics/:clinicId/laya/status', { preHandler: requireRole('ia_studio_admin') }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const parsed = paramsSchema.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid clinic' })
    const { clinicId } = parsed.data
    let clinicOptIn: LayaDiagnosticStatus['clinicOptIn'] = 'unknown'
    try {
      const rows = await withDb(sql => createLayaControlsRepository(sql).readForClinic(clinicId))
      clinicOptIn = resolveLayaControls(clinicId, rows).enabled ? 'enabled' : 'disabled'
    } catch { /* Do not misreport failed control reads as confirmed disablement. */ }
    const health = await runtimeJson('/health', 1000)
    const ready = await runtimeJson('/ready', 1000)
    const service = health.kind === 'json' && z.object({ status: z.literal('alive') }).safeParse(health.value).success
      ? 'reachable' : 'unavailable'
    const model = ready.kind === 'json' && z.object({ status: z.literal('ready') }).safeParse(ready.value).success
      ? 'ready' : service === 'reachable' ? 'not_ready' : 'unknown'
    // getLayaAdapter installs no reviewed calibration. A health check or opt-in
    // must never be presented as qualification or permission for patient decisions.
    return { clinicId, checkedAt: new Date().toISOString(), service, model, clinicOptIn,
      qualification: 'unqualified', patientDecisions: 'blocked' } satisfies LayaDiagnosticStatus
  })

  app.post('/clinics/:clinicId/laya/test', { preHandler: requireRole('ia_studio_admin') }, async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const params = paramsSchema.safeParse(request.params)
    const parsed = testSchema.safeParse(request.body)
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid diagnostic request' })
    if (running || Date.now() < nextTestAt) {
      reply.header('retry-after', '10')
      return reply.code(429).send({ error: 'Diagnostic cooldown' })
    }
    running = true
    const start = performance.now()
    const { language } = parsed.data
    const requestId = randomUUID()
    try {
      const result = await runtimeJson('/v1/decision', 1500, {
        schemaVersion: 1, requestId, task: 'administrative_intent', language,
        text: language === 'en' ? 'I want to book an appointment.' : 'Quiero reservar una cita.',
        candidates: language === 'en'
          ? [{ id: 'book', label: 'Book an appointment' }, { id: 'hours', label: 'Clinic business hours' }]
          : [{ id: 'book', label: 'Reservar una cita' }, { id: 'hours', label: 'Horario de la clínica' }],
      })
      const base = { clinicId: params.data.clinicId, language, checkedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - start), qualification: 'unqualified' as const }
      if (result.kind !== 'json') return { ...base, outcome: result.kind } satisfies LayaDiagnosticTest
      const decision = decisionSchema.safeParse(result.value)
      if (!decision.success || decision.data.requestId !== requestId || (decision.data.choiceId === null && !decision.data.abstain)) {
        return { ...base, outcome: 'invalid_response' } satisfies LayaDiagnosticTest
      }
      const choice = decision.data.abstain ? null : decision.data.choiceId
      return { ...base, outcome: 'response', choice, expectedChoice: 'book', matchesExpected: choice === 'book' } satisfies LayaDiagnosticTest
    } finally {
      running = false
      nextTestAt = Date.now() + 10_000
    }
  })
}

export default layaDiagnosticsRoute
