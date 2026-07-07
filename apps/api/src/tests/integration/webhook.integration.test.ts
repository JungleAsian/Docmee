// P17 — Full webhook flow integration test (Gap #40).
//
//   1. POST /webhook/whatsapp with a valid HMAC signature
//   2. Verify a job is enqueued on the whatsapp.inbound queue (real Redis)
//   3. Process that job through the real conversation worker
//   4. Verify an `agent` job is enqueued downstream
//
// Runs against a real local Redis + test Postgres. Skipped when either is
// unreachable so the headless gate stays green (see _infra.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'
import { redisAvailable, dbAvailable, serviceDb, flushQueues, waitFor } from './_infra.js'

const SECRET = 'integration-webhook-secret'
const VERIFY = 'integration-verify-token'
const PHONE_NUMBER_ID = 'integration-phone-number-id'
const PATIENT_WA_ID = '5215550009999'

// Resolved at runtime (non-literal specifier) so TypeScript never pulls the
// worker's source into the API program — keeps the typecheck gate isolated.
const CONVERSATION_WORKER_PATH = ['..', '..', '..', '..', 'workers', 'src', 'conversation-processor.worker.js'].join('/')

interface ConversationWorker {
  processConversationJob: (job: { data: Record<string, unknown> }) => Promise<void>
}

const sign = (body: string) =>
  `sha256=${createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex')}`

const payload = (text: string, id: string) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Integration Ana' }, wa_id: PATIENT_WA_ID }],
              messages: [
                { from: PATIENT_WA_ID, id, timestamp: '1700000000', type: 'text', text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  })

const hasRedis = await redisAvailable()
const hasDb = await dbAvailable()

describe.skipIf(!hasRedis)('webhook → queue → worker integration', () => {
  // Loaded dynamically so the real Redis-backed queue modules only initialise
  // when Redis is actually reachable.
  let app: Awaited<ReturnType<(typeof import('../../app.js'))['buildApp']>>
  let queues: typeof import('@docmee/queue')
  let worker: ConversationWorker | undefined
  let clinicId: string | undefined

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['META_APP_SECRET'] = SECRET
    process.env['META_VERIFY_TOKEN'] = VERIFY
    process.env['LLM_STUB'] = 'true'

    queues = await import('@docmee/queue')
    await flushQueues('whatsapp.inbound', 'agent')

    const { buildApp } = await import('../../app.js')
    app = await buildApp()
    await app.ready()

    // Seed the owning clinic + channel account so the worker can resolve the
    // phone_number_id → clinic. Only possible when the test DB is up.
    if (hasDb) {
      worker = (await import(CONVERSATION_WORKER_PATH)) as ConversationWorker
      const sql = serviceDb()
      try {
        const slug = `int-webhook-${PHONE_NUMBER_ID}`
        const [clinic] = await sql<{ id: string }[]>`
          INSERT INTO clinics (name, slug, plan, status)
          VALUES ('Integration Clinic', ${slug}, 'pro', 'active')
          ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `
        clinicId = clinic?.id
        if (clinicId) {
          await sql`
            INSERT INTO channel_accounts (clinic_id, channel, account_id, display_name, status)
            VALUES (${clinicId}, 'whatsapp', ${PHONE_NUMBER_ID}, 'Integration WA', 'active')
            ON CONFLICT DO NOTHING
          `
        }
      } finally {
        await sql.end()
      }
    }
  })

  afterAll(async () => {
    if (app) await app.close()
    if (hasDb && clinicId) {
      const sql = serviceDb()
      try {
        await sql`DELETE FROM channel_accounts WHERE account_id = ${PHONE_NUMBER_ID}`
        await sql`DELETE FROM clinics WHERE id = ${clinicId}`
      } finally {
        await sql.end()
      }
    }
    if (queues) {
      await flushQueues('whatsapp.inbound', 'agent')
      await queues.whatsappInboundQueue.close()
      await queues.agentQueue.close()
    }
  })

  it('GET verification returns the challenge', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=4242`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('4242')
  })

  it('POST with a valid HMAC enqueues a whatsapp.inbound job', async () => {
    const body = payload('hola integration', 'wamid.int.enqueue')
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    })
    expect(res.statusCode).toBe(200)

    const job = await waitFor(async () => {
      const jobs = await queues.whatsappInboundQueue.getJobs(['waiting', 'delayed', 'active', 'completed'])
      return jobs.find((j) => (j.data as { phoneNumberId?: string }).phoneNumberId === PHONE_NUMBER_ID) ?? null
    })
    expect(job).toBeTruthy()
    const data = job!.data as { patientWaId: string; content: string }
    expect(data.patientWaId).toBe(PATIENT_WA_ID)
    expect(data.content).toBe('hola integration')
  })

  it.skipIf(!hasDb)('conversation worker re-enqueues an agent job', async () => {
    expect(worker).toBeTruthy()
    // Drive the worker directly with a synthetic job (no live Worker process needed).
    await worker!.processConversationJob({
      data: {
        channel: 'whatsapp',
        phoneNumberId: PHONE_NUMBER_ID,
        patientWaId: PATIENT_WA_ID,
        patientName: 'Integration Ana',
        messageType: 'text',
        content: 'necesito una cita',
        waMessageId: 'wamid.int.worker',
        timestamp: 1700000000,
      },
    })

    const agentJob = await waitFor(async () => {
      const jobs = await queues.agentQueue.getJobs(['waiting', 'delayed', 'active', 'completed'])
      return jobs.find((j) => (j.data as { patientWaId?: string }).patientWaId === PATIENT_WA_ID) ?? null
    })
    expect(agentJob).toBeTruthy()
    const data = agentJob!.data as { message: string; clinicId: string }
    expect(data.message).toBe('necesito una cita')
    expect(data.clinicId).toBe(clinicId)
  })
})
