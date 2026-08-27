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
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { decryptValue } from '@docmee/shared'
import {
  createConversationsRepository,
  createMessagesRepository,
  createChannelAccountsRepository,
  createErrorReviewsRepository,
  createMediaAssetsRepository,
} from '@docmee/db'
import { withDb } from '../lib/db.js'
import { uploadWhatsAppMedia, sendWhatsAppDocument, sendWhatsAppImage } from '../lib/channel-send.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  deleteKbVaultObject,
  isEligibleWhatsAppMediaAsset,
  kbVaultEnabled,
  MEDIA_ASSET_MAX_ACTIVE_FILES,
  MEDIA_ASSET_QUOTA_BYTES,
  mediaObjectKey,
  readKbVaultObject,
  uploadKbVaultObject,
  validateMediaAsset,
  WHATSAPP_IMAGE_MAX_BYTES,
} from '../lib/kb-vault-storage.js'

const PROVIDER_SEND_FAILED = 'provider_send_failed'
const storedAssetSchema = z.object({
  assetId: z.string().min(1),
  caption: z.string().trim().max(1024).optional(),
}).strict()

function readChannelToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

const conversationMediaRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: WHATSAPP_IMAGE_MAX_BYTES } })
  app.addHook('preHandler', requireAuth)

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/send-media',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })

      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'No file uploaded' })
      if (!isEligibleWhatsAppMediaAsset({ contentType: file.mimetype, byteSize: 1 })) {
        return reply.code(400).send({ error: 'Only JPEG or PNG images are supported' })
      }
      const buffer = await file.toBuffer()
      const validationError = validateMediaAsset({
        contentType: file.mimetype,
        byteSize: buffer.length,
        signatureBytes: buffer.subarray(0, 512),
      })
      if (validationError === 'invalid_signature') {
        return reply.code(400).send({ error: 'File content does not match its declared type' })
      }
      if (validationError) return reply.code(validationError === 'too_large' ? 413 : 400).send({ error: 'Invalid media file' })
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
        const token = readChannelToken(account?.accessTokenEnc)
        if (!account || !token) return { code: 502 as const }
        return {
          code: 200 as const,
          convo,
          phoneNumberId: account.accountId,
          token,
          recipient: convo.channelContactHandle,
        }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      if (resolved.code === 400) {
        return reply.code(400).send({ error: 'Images can only be sent on WhatsApp' })
      }
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      const checksum = createHash('sha256').update(buffer).digest('hex')
      const key = mediaObjectKey({ clinicId, assetId: randomUUID(), fileName: file.filename || 'image' })
      await uploadKbVaultObject({
        key,
        body: buffer,
        contentType: file.mimetype,
        metadata: { clinicId, checksum, source: 'whatsapp-outbound' },
      })

      let asset
      try {
        asset = await withDb((sql) => createMediaAssetsRepository(sql).createWithinQuota({
          clinicId,
          uploadedBy: request.user!.userId,
          filename: file.filename || 'image',
          contentType: file.mimetype as 'image/jpeg' | 'image/png',
          byteSize: buffer.length,
          checksum,
          storageKey: key,
        }, { maxFiles: MEDIA_ASSET_MAX_ACTIVE_FILES, maxBytes: MEDIA_ASSET_QUOTA_BYTES }))
      } catch (error) {
        await deleteKbVaultObject(key).catch((cleanupError) => {
          request.log.error(`[send-media] failed to clean up rejected upload: ${(cleanupError as Error).message}`)
        })
        if (error instanceof Error && error.message === 'media_file_limit_reached') {
          return reply.code(413).send({ error: 'Clinic media file limit reached (10 active files)' })
        }
        if (error instanceof Error && error.message === 'media_quota_exceeded') {
          return reply.code(413).send({ error: 'Clinic media quota exceeded' })
        }
        throw error
      }

      // Persist the complete local attempt and human takeover before any Meta call.
      const pending = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: caption,
          contentType: 'image',
          channelMessageId: undefined,
          metadata: {
            authorId: request.user!.userId,
            mediaAssetId: asset.id,
            mimeType: file.mimetype,
            filename: file.filename || 'image',
            providerStatus: 'pending',
          },
        })
        const attachment = await createMediaAssetsRepository(sql).attach({
          clinicId,
          messageId: created.id,
          mediaAssetId: asset.id,
          providerMessageId: null,
          providerStatus: 'pending',
        })
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
        return { message: created, attachment }
      })

      let mediaId: string
      let channelMessageId: string
      try {
        mediaId = await uploadWhatsAppMedia(
          resolved.phoneNumberId,
          resolved.token,
          buffer,
          file.mimetype,
          file.filename || 'image',
        )
        const sentId = await sendWhatsAppImage(
          resolved.phoneNumberId,
          resolved.token,
          resolved.recipient,
          mediaId,
          caption || undefined,
        )
        if (!sentId) throw new Error('Provider accepted no message identifier')
        channelMessageId = sentId
      } catch {
        request.log.error('[send-media] provider media send failed')
        await withDb(async (sql) => {
          await createMediaAssetsRepository(sql).markOutboundFailed({
            clinicId,
            messageId: pending.message.id,
            attachmentId: pending.attachment.id,
            failureCode: PROVIDER_SEND_FAILED,
          })
          await createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: 'Provider media send failed',
            context: {
              outboundMessageId: pending.message.id,
              conversationId: request.params.id,
              channel: 'whatsapp',
              sentBy: request.user!.userId,
            },
          })
        }).catch((logError) => {
          request.log.error(`[send-media] failed to persist send failure: ${(logError as Error).message}`)
        })
        return reply.code(502).send({ error: 'Image send failed' })
      }

      await withDb((sql) => createMediaAssetsRepository(sql).markOutboundAccepted({
        clinicId,
        messageId: pending.message.id,
        attachmentId: pending.attachment.id,
        providerMessageId: channelMessageId,
        providerMediaId: mediaId,
      }))
      return reply.code(201).send({
        message: {
          ...pending.message,
          channelMessageId,
          metadata: {
            ...pending.message.metadata,
            mediaId,
            providerStatus: 'accepted',
            providerAccepted: true,
          },
        },
      })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/send-media-asset',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = storedAssetSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid media asset request' })
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const resolved = await withDb(async (sql) => {
        const conversation = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!conversation) return { code: 404 as const }
        if (conversation.channel !== 'whatsapp') return { code: 400 as const }
        const asset = await createMediaAssetsRepository(sql).findById(clinicId, parsed.data.assetId)
        if (!asset || asset.deletedAt) return { code: 404 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((candidate) => candidate.channel === 'whatsapp' && candidate.status === 'active')
        const token = readChannelToken(account?.accessTokenEnc)
        if (!account || !token) return { code: 502 as const }
        return { code: 200 as const, conversation, asset, account, token }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation or media asset not found' })
      if (resolved.code === 400) return reply.code(400).send({ error: 'Media can only be sent on WhatsApp' })
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })
      if (!isEligibleWhatsAppMediaAsset(resolved.asset)) {
        return reply.code(400).send({ error: 'WhatsApp media must be a PDF up to 100 MB or a JPEG/PNG image up to 5 MB' })
      }

      const bytes = await readKbVaultObject(resolved.asset.storageKey)
      if (!bytes) return reply.code(503).send({ error: 'Private media storage is not configured' })
      const storedValidationError = validateMediaAsset({
        contentType: resolved.asset.contentType,
        byteSize: bytes.byteLength,
        signatureBytes: bytes.subarray(0, 512),
      })
      if (storedValidationError || bytes.byteLength !== resolved.asset.byteSize) {
        return reply.code(400).send({ error: 'Stored media content does not match its declared type' })
      }
      if (!isEligibleWhatsAppMediaAsset({ contentType: resolved.asset.contentType, byteSize: bytes.byteLength })) {
        return reply.code(400).send({ error: 'WhatsApp media must be a PDF up to 100 MB or a JPEG/PNG image up to 5 MB' })
      }
      const caption = parsed.data.caption || undefined
      const pending = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: caption ?? (resolved.asset.contentType === 'application/pdf' ? resolved.asset.filename : ''),
          contentType: resolved.asset.contentType === 'application/pdf' ? 'document' : 'image',
          channelMessageId: undefined,
          metadata: {
            authorId: request.user!.userId,
            mediaAssetId: resolved.asset.id,
            mimeType: resolved.asset.contentType,
            filename: resolved.asset.filename,
            providerStatus: 'pending',
          },
        })
        const attachment = await createMediaAssetsRepository(sql).attach({
          clinicId,
          messageId: created.id,
          mediaAssetId: resolved.asset.id,
          providerMessageId: null,
          providerStatus: 'pending',
        })
        if (resolved.conversation.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.conversation.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        return { message: created, attachment }
      })

      let mediaId: string
      let channelMessageId: string
      try {
        mediaId = await uploadWhatsAppMedia(
          resolved.account.accountId,
          resolved.token,
          bytes,
          resolved.asset.contentType,
          resolved.asset.filename,
        )
        const sentId = resolved.asset.contentType === 'application/pdf'
          ? await sendWhatsAppDocument(
              resolved.account.accountId,
              resolved.token,
              resolved.conversation.channelContactHandle,
              mediaId,
              resolved.asset.filename,
              caption,
            )
          : await sendWhatsAppImage(
              resolved.account.accountId,
              resolved.token,
              resolved.conversation.channelContactHandle,
              mediaId,
              caption,
            )
        if (!sentId) throw new Error('Provider accepted no message identifier')
        channelMessageId = sentId
      } catch {
        request.log.error('[send-media-asset] provider media send failed')
        await withDb(async (sql) => {
          await createMediaAssetsRepository(sql).markOutboundFailed({
            clinicId,
            messageId: pending.message.id,
            attachmentId: pending.attachment.id,
            failureCode: PROVIDER_SEND_FAILED,
          })
          await createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: 'Provider media send failed',
            context: {
              outboundMessageId: pending.message.id,
              conversationId: request.params.id,
              channel: 'whatsapp',
              sentBy: request.user!.userId,
            },
          })
        }).catch((logError) => {
          request.log.error(`[send-media-asset] failed to persist send failure: ${(logError as Error).message}`)
        })
        return reply.code(502).send({ error: 'Media send failed' })
      }

      await withDb((sql) => createMediaAssetsRepository(sql).markOutboundAccepted({
        clinicId,
        messageId: pending.message.id,
        attachmentId: pending.attachment.id,
        providerMessageId: channelMessageId,
        providerMediaId: mediaId,
      }))
      return reply.code(201).send({
        message: {
          ...pending.message,
          channelMessageId,
          metadata: {
            ...pending.message.metadata,
            mediaId,
            providerStatus: 'accepted',
            providerAccepted: true,
          },
        },
      })
    },
  )
}

export default conversationMediaRoute
