// Outbound media send (Req 3) — a secretary attaches an image from the inbox and
// it is DELIVERED to the patient over WhatsApp, not merely persisted.
//   POST /conversations/:id/send-media   (secretary, doctor, clinic_admin)
//     multipart/form-data: `file` (the image) + optional `caption`
//
// This is the two-step WhatsApp Cloud API media flow: the bytes are uploaded to
// Meta (`uploadWhatsAppMedia`) to obtain a media id, then an `image` message
// referencing that id is sent (`sendWhatsAppImage`). The returned wamid is
// persisted as conversation_messages.channel_message_id so the delivery-status
// pipeline + the inbox ✓/✓✓/read indicator track it exactly like a text reply,
// and the uploaded media id is stored on metadata so the existing authenticated
// media proxy renders the sent image inline (the same way an inbound image renders).
//
// It is a SEPARATE plugin from conversations.ts so @fastify/multipart is
// encapsulated here (Fastify parsers are per-plugin) and never interferes with the
// JSON body parsing the rest of the conversation routes rely on — mirroring
// kb-upload.ts. Images are WhatsApp-only here (Messenger/Instagram attachment
// upload is a different mechanism); a non-WhatsApp thread → 400.
import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createHash } from 'node:crypto'
import {
  createConversationsRepository,
  createMessagesRepository,
  createChannelAccountsRepository,
  createErrorReviewsRepository,
  createMediaAssetsRepository,
} from '@docmee/db'
import { withDb } from '../lib/db.js'
import { uploadWhatsAppMedia, sendWhatsAppImage } from '../lib/channel-send.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { kbVaultEnabled, mediaObjectKey, uploadKbVaultObject } from '../lib/kb-vault-storage.js'

// WhatsApp accepts JPEG and PNG for image messages; cap at Meta's 5 MB image limit.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const conversationMediaRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES } })
  app.addHook('preHandler', requireAuth)

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/send-media',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      // Consume the multipart body first (the file part + an optional caption field
      // that the client appends before the file).
      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'No file uploaded' })
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        return reply.code(400).send({ error: 'Only JPEG or PNG images are supported' })
      }
      const buffer = await file.toBuffer()
      const captionField = (file.fields as Record<string, { value?: unknown } | undefined>)['caption']
      const caption = typeof captionField?.value === 'string' ? captionField.value.trim() : ''

      // Resolve the conversation + the clinic's active WhatsApp credentials. The
      // upload/send happens OUTSIDE the db callback so no connection is held across
      // the Meta round-trip (mirrors the manual-reply send + the media proxy).
      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }
        // Outbound image attachment is WhatsApp-only here.
        if (convo.channel !== 'whatsapp') return { code: 400 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
        if (!account?.accessTokenEnc) return { code: 502 as const }
        return {
          code: 200 as const,
          convo,
          phoneNumberId: account.accountId,
          token: account.accessTokenEnc,
          recipient: convo.channelContactHandle,
        }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      if (resolved.code === 400) {
        return reply.code(400).send({ error: 'Images can only be sent on WhatsApp' })
      }
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      // Deliver to the patient. A failed upload/send (expired/invalid token, an
      // image rejected outside the 24h window, rate limit) is recorded to the Error
      // Review area as `meta_send_failure` (Req 19/29) and surfaced as a 502 —
      // nothing is persisted, so the secretary can retry rather than leave a phantom
      // "sent" bubble that never arrived.
      let mediaId: string
      let channelMessageId: string | null = null
      try {
        mediaId = await uploadWhatsAppMedia(
          resolved.phoneNumberId,
          resolved.token,
          buffer,
          file.mimetype,
          file.filename || 'image',
        )
        channelMessageId = await sendWhatsAppImage(
          resolved.phoneNumberId,
          resolved.token,
          resolved.recipient,
          mediaId,
          caption || undefined,
        )
      } catch (err) {
        request.log.error(`[send-media] channel send failed: ${(err as Error).message}`)
        await withDb((sql) =>
          createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: err instanceof Error ? err.message : String(err),
            context: {
              conversationId: request.params.id,
              channel: 'whatsapp',
              recipient: resolved.recipient,
              sentBy: request.user!.userId,
            },
          }),
        ).catch((logErr) =>
          request.log.error(`[send-media] failed to log send error: ${(logErr as Error).message}`),
        )
        return reply.code(502).send({ error: 'Image send failed' })
      }

      const message = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          // The caption (if any) is the bubble text; the image renders from the
          // stored media id via the authenticated media proxy.
          content: caption,
          contentType: 'image',
          channelMessageId: channelMessageId ?? undefined,
          metadata: { authorId: request.user!.userId, mediaId, mimeType: file.mimetype },
        })
        // Bot Interruption Rule (Rev1 #6): attaching an image is a human takeover.
        if (resolved.convo.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.convo.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        // Keep an internal, clinic-scoped copy when private media storage is
        // configured. The Meta media id remains in message metadata for the
        // authenticated WhatsApp proxy; this asset record gives the clinic a
        // durable repository entry and lets delivery receipts correlate to it.
        if (kbVaultEnabled()) {
          const checksum = createHash('sha256').update(buffer).digest('hex')
          const key = mediaObjectKey({ clinicId, assetId: checksum.slice(0, 24), fileName: file.filename || 'image' })
          await uploadKbVaultObject({ key, body: buffer, contentType: file.mimetype, metadata: { clinicId, checksum, source: 'whatsapp-outbound', mediaId } })
          const asset = await createMediaAssetsRepository(sql).create({
            clinicId,
            uploadedBy: request.user!.userId,
            filename: file.filename || 'image',
            contentType: file.mimetype as 'image/jpeg' | 'image/png',
            byteSize: buffer.length,
            checksum,
            storageKey: key,
          })
          await createMediaAssetsRepository(sql).attach({
            clinicId,
            messageId: created.id,
            mediaAssetId: asset.id,
            providerMessageId: channelMessageId,
            providerStatus: channelMessageId ? 'accepted' : 'pending',
          })
        }
        return created
      })
      return reply.code(201).send({ message })
    },
  )
}

export default conversationMediaRoute
