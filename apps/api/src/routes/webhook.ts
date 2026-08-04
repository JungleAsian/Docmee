import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { whatsappInboundQueue, whatsappStatusQueue } from '@docmee/queue'
import { validateHmacSignature } from '../lib/hmac.js'
import { withDb } from '../lib/db.js'

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer }

// WhatsApp Cloud API inbound payload (the subset we act on).
const WhatsAppEntrySchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.enum(['messages', 'history', 'smb_app_state_sync', 'smb_message_echoes']),
          value: z.object({
            messaging_product: z.literal('whatsapp').optional(),
            metadata: z
              .object({
                display_phone_number: z.string(),
                phone_number_id: z.string(),
              })
              .optional(),
            contacts: z
              .array(z.object({ profile: z.object({ name: z.string() }), wa_id: z.string() }))
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.enum(['text', 'audio', 'image', 'document', 'button', 'interactive']),
                  text: z.object({ body: z.string() }).optional(),
                  audio: z.object({ id: z.string(), mime_type: z.string() }).optional(),
                  // Inbound media (Req 3): an image/document carries a media id we
                  // resolve + proxy on demand, plus an optional caption shown as text.
                  image: z
                    .object({ id: z.string(), mime_type: z.string(), caption: z.string().optional() })
                    .optional(),
                  document: z
                    .object({ id: z.string(), mime_type: z.string(), caption: z.string().optional() })
                    .optional(),
                  // Interactive replies (Req 3): when a patient taps a reply button
                  // or picks a list row, Meta sends the selection here — the `title`
                  // is the human-readable text the patient saw, which we treat as the
                  // message content so intent classification works exactly as for text.
                  interactive: z
                    .object({
                      type: z.string().optional(),
                      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                      list_reply: z
                        .object({
                          id: z.string(),
                          title: z.string(),
                          description: z.string().optional(),
                        })
                        .optional(),
                    })
                    .optional(),
                  // Legacy template quick-reply button: `text` is what the patient
                  // tapped (the payload is an opaque developer-defined string).
                  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
                }),
              )
              .optional(),
            // Delivery-status receipts (Req 3). Meta posts these under the same
            // `messages` field — id is the outbound wamid we sent, status is the
            // lifecycle state, errors carries the failure reason on status='failed'.
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.enum(['sent', 'delivered', 'read', 'failed']),
                  timestamp: z.string(),
                  recipient_id: z.string(),
                  errors: z
                    .array(z.object({ code: z.number().optional(), title: z.string().optional() }))
                    .optional(),
                }),
              )
              .optional(),
          }).passthrough(),
        }),
      ),
    }),
  ),
})

// Req 3: the human-readable text of an interactive reply (button tap or list
// pick) or a legacy template quick-reply button. Returns undefined for a message
// that carries none, so the caller's `??` chain falls through.

async function isAllowedVerifyToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  if (token === process.env['META_VERIFY_TOKEN']) return true
  try {
    const rows = await withDb((sql) => sql<{ exists: boolean }[]>`
      SELECT true AS exists
      FROM channel_accounts
      WHERE channel = 'whatsapp' AND webhook_verify_token = ${token}
      LIMIT 1
    `)
    return Boolean(rows[0]?.exists)
  } catch {
    // Verification must fail closed when the account-token lookup is unavailable.
    return false
  }
}

function interactiveText(msg: {
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }
  button?: { text: string }
}): string | undefined {
  return (
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    msg.button?.text
  )
}

// Single Choice (Punchlist Aug 3 parity spec): the stable id of a tapped
// button/list row, so a Custom Flow can route on the id instead of fuzzy-
// matching `interactiveText()`'s (possibly retranslated) title. undefined for
// a legacy template quick-reply button, which carries no id.
function interactiveReplyId(msg: {
  interactive?: { button_reply?: { id: string }; list_reply?: { id: string } }
}): string | undefined {
  return msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id
}

const webhookRoute: FastifyPluginAsync = async (app) => {
  // Capture the raw body so HMAC validation sees exactly what Meta signed.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    ;(req as RawBodyRequest).rawBody = body as Buffer
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')))
    } catch (err) {
      done(err as Error)
    }
  })

  // GET — Meta verification challenge.
  app.get('/whatsapp', async (request, reply) => {
    const q = request.query as Record<string, string>
    if (q['hub.mode'] === 'subscribe' && (await isAllowedVerifyToken(q['hub.verify_token']))) {
      return reply.code(200).send(q['hub.challenge'])
    }
    return reply.code(403).send({ error: 'Forbidden' })
  })

  // POST — inbound messages. Always answer 200 fast; Meta retries otherwise.
  app.post('/whatsapp', async (request, reply) => {
    reply.code(200).send()

    try {
      const rawBody = (request as RawBodyRequest).rawBody ?? Buffer.from('')
      const signature = request.headers['x-hub-signature-256'] as string | undefined
      const secret = process.env['META_APP_SECRET'] ?? ''

      if (!validateHmacSignature(rawBody, signature, secret)) {
        app.log.warn('[webhook] invalid HMAC signature — ignoring')
        return
      }

      const parsed = WhatsAppEntrySchema.safeParse(request.body)
      if (!parsed.success) {
        app.log.warn(`[webhook] invalid payload shape: ${parsed.error.message}`)
        return
      }

      for (const entry of parsed.data.entry) {
        for (const change of entry.changes) {
          if (change.field !== 'messages' || !change.value.metadata) {
            app.log.info(`[webhook] accepted WhatsApp ${change.field} sync event`)
            continue
          }
          const { metadata, messages, contacts, statuses } = change.value
          for (const msg of messages ?? []) {
            await whatsappInboundQueue.add('inbound', {
              phoneNumberId: metadata.phone_number_id,
              patientWaId: msg.from,
              patientName: contacts?.[0]?.profile.name ?? '',
              messageType: msg.type,
              content:
                msg.text?.body ??
                msg.image?.caption ??
                msg.document?.caption ??
                interactiveText(msg),
              interactiveReplyId: interactiveReplyId(msg),
              mediaId: msg.audio?.id ?? msg.image?.id ?? msg.document?.id,
              mimeType: msg.audio?.mime_type ?? msg.image?.mime_type ?? msg.document?.mime_type,
              waMessageId: msg.id,
              timestamp: Number.parseInt(msg.timestamp, 10),
            })
          }
          // Delivery-status receipts (Req 3): fan out to the status worker, which
          // matches the wamid back to the persisted outbound message and records
          // the event (logging an error review on a failed delivery).
          for (const st of statuses ?? []) {
            await whatsappStatusQueue.add('status', {
              phoneNumberId: metadata.phone_number_id,
              channelMessageId: st.id,
              status: st.status,
              recipientId: st.recipient_id,
              timestamp: Number.parseInt(st.timestamp, 10),
              errorTitle: st.errors?.[0]?.title,
              errorCode: st.errors?.[0]?.code,
            })
          }
        }
      }
    } catch (err) {
      app.log.error(`[webhook] processing failed: ${(err as Error).message}`)
    }
  })
}

export default webhookRoute
