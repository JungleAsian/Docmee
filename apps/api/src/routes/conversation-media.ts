import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { decryptValue } from '@docmee/shared'
import {
  createChannelAccountsRepository,
  createConversationsRepository,
  createMediaAssetsRepository,
} from '@docmee/db'
import type { OutboundMediaAttempt, ConversationMessage, MessageAttachment, MediaAsset } from '@docmee/db'
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

const PROVIDER_OUTCOME_UNCERTAIN = 'provider_outcome_uncertain'
const ACCEPTANCE_RECONCILIATION_FAILED = 'acceptance_reconciliation_failed'
const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const storedAssetSchema = z.object({
  assetId: z.string().min(1),
  caption: z.string().trim().max(1024).optional(),
}).strict()

type AttemptBundle = {
  attempt: OutboundMediaAttempt
  message: ConversationMessage
  attachment: MessageAttachment
}

function readChannelToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

function readIdempotencyKey(request: FastifyRequest): string | null {
  const raw = request.headers['idempotency-key']
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(raw) ? raw[0] : raw)
  return parsed.success ? parsed.data : null
}

function attemptResponse(reply: FastifyReply, bundle: AttemptBundle, created = false) {
  const accepted = bundle.attempt.status === 'accepted'
  return reply.code(accepted ? (created ? 201 : 200) : 202).send({
    status: bundle.attempt.status,
    retryable: false,
    attemptId: bundle.attempt.id,
    message: bundle.message,
  })
}

async function markUncertain(
  request: FastifyRequest,
  clinicId: string,
  attemptId: string,
  failureCode: string,
  providerMediaId?: string,
  providerMessageId?: string,
) {
  await withDb((sql) => createMediaAssetsRepository(sql).markOutboundUncertain({
    clinicId,
    attemptId,
    failureCode,
    providerMediaId: providerMediaId ?? null,
    providerMessageId: providerMessageId ?? null,
  })).catch((error) => {
    request.log.error(`[conversation-media] failed to persist uncertain state: ${(error as Error).message}`)
  })
}

async function cleanupReservedAsset(request: FastifyRequest, clinicId: string, assetId: string, storageKey: string) {
  await withDb((sql) => createMediaAssetsRepository(sql).beginDeletion(clinicId, assetId))
  try {
    const deleted = await deleteKbVaultObject(storageKey)
    if (!deleted) throw new Error('S3 storage is unavailable')
    await withDb((sql) => createMediaAssetsRepository(sql).markDeletionComplete(clinicId, assetId))
  } catch (error) {
    await withDb((sql) => createMediaAssetsRepository(sql).markDeletionFailed(clinicId, assetId, 's3_delete_failed')).catch((persistError) => {
      request.log.error(`[conversation-media] failed to persist cleanup failure: ${(persistError as Error).message}`)
    })
    throw error
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
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) return reply.code(400).send({ error: 'A valid Idempotency-Key header is required' })

      const existing = await withDb((sql) => createMediaAssetsRepository(sql).findOutboundAttempt(clinicId, request.params.id, idempotencyKey))
      if (existing) return attemptResponse(reply, existing)
      if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })

      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'No file uploaded' })
      if (!isEligibleWhatsAppMediaAsset({ contentType: file.mimetype, byteSize: 1 })) {
        return reply.code(400).send({ error: 'Only JPEG or PNG images are supported' })
      }
      const buffer = await file.toBuffer()
      const validationError = validateMediaAsset({ contentType: file.mimetype, byteSize: buffer.length, signatureBytes: buffer.subarray(0, 512) })
      if (validationError === 'invalid_signature') return reply.code(400).send({ error: 'File content does not match its declared type' })
      if (validationError) return reply.code(validationError === 'too_large' ? 413 : 400).send({ error: 'Invalid media file' })
      const captionField = (file.fields as Record<string, { value?: unknown } | undefined>)['caption']
      const caption = typeof captionField?.value === 'string' ? captionField.value.trim() : ''

      const resolved = await withDb(async (sql) => {
        const conversation = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!conversation) return { code: 404 as const }
        if (conversation.channel !== 'whatsapp') return { code: 400 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((candidate) => candidate.channel === 'whatsapp' && candidate.status === 'active')
        const token = readChannelToken(account?.accessTokenEnc)
        if (!account || !token) return { code: 502 as const }
        return { code: 200 as const, conversation, account, token }
      })
      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      if (resolved.code === 400) return reply.code(400).send({ error: 'Images can only be sent on WhatsApp' })
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      const checksum = createHash('sha256').update(buffer).digest('hex')
      const assetId = randomUUID()
      const key = mediaObjectKey({ clinicId, assetId, fileName: file.filename || 'image' })
      let asset: MediaAsset
      try {
        asset = await withDb((sql) => createMediaAssetsRepository(sql).reserveWithinQuota({
          id: assetId,
          clinicId,
          uploadedBy: request.user!.userId,
          filename: file.filename || 'image',
          contentType: file.mimetype as 'image/jpeg' | 'image/png',
          byteSize: buffer.length,
          checksum,
          storageKey: key,
        }, { maxFiles: MEDIA_ASSET_MAX_ACTIVE_FILES, maxBytes: MEDIA_ASSET_QUOTA_BYTES }))
      } catch (error) {
        if (error instanceof Error && error.message === 'media_file_limit_reached') return reply.code(413).send({ error: 'Clinic media file limit reached (10 active files)' })
        if (error instanceof Error && error.message === 'media_quota_exceeded') return reply.code(413).send({ error: 'Clinic media quota exceeded' })
        throw error
      }

      try {
        await uploadKbVaultObject({ key, body: buffer, contentType: file.mimetype, metadata: { clinicId, checksum, source: 'whatsapp-outbound' } })
        await withDb((sql) => createMediaAssetsRepository(sql).markUploadReady(clinicId, asset.id))
      } catch (error) {
        await cleanupReservedAsset(request, clinicId, asset.id, key).catch(() => undefined)
        request.log.error(`[send-media] private storage upload failed: ${(error as Error).message}`)
        return reply.code(503).send({ error: 'Private media storage upload failed' })
      }

      const prepared = await withDb((sql) => createMediaAssetsRepository(sql).prepareOutbound({
        clinicId,
        conversationId: request.params.id,
        mediaAssetId: asset.id,
        idempotencyKey,
        authorId: request.user!.userId,
        content: caption,
        contentType: 'image',
        metadata: { authorId: request.user!.userId, mediaAssetId: asset.id, mimeType: file.mimetype, filename: file.filename || 'image' },
      }))
      if (!prepared.created) {
        await cleanupReservedAsset(request, clinicId, asset.id, key).catch(() => undefined)
        return attemptResponse(reply, prepared)
      }

      let providerMediaId: string | undefined
      let providerMessageId: string | undefined
      try {
        providerMediaId = await uploadWhatsAppMedia(resolved.account.accountId, resolved.token, buffer, file.mimetype, file.filename || 'image')
        const sentId = await sendWhatsAppImage(resolved.account.accountId, resolved.token, resolved.conversation.channelContactHandle, providerMediaId, caption || undefined)
        if (!sentId) throw new Error('Provider accepted no message identifier')
        providerMessageId = sentId
      } catch {
        await markUncertain(request, clinicId, prepared.attempt.id, PROVIDER_OUTCOME_UNCERTAIN, providerMediaId, providerMessageId)
        return reply.code(202).send({ status: 'uncertain', retryable: false, attemptId: prepared.attempt.id, message: prepared.message })
      }

      try {
        await withDb((sql) => createMediaAssetsRepository(sql).markOutboundAccepted({ clinicId, attemptId: prepared.attempt.id, providerMessageId, providerMediaId }))
      } catch {
        await markUncertain(request, clinicId, prepared.attempt.id, ACCEPTANCE_RECONCILIATION_FAILED, providerMediaId, providerMessageId)
        return reply.code(202).send({ status: 'uncertain', retryable: false, attemptId: prepared.attempt.id, message: prepared.message })
      }
      return attemptResponse(reply, {
        ...prepared,
        attempt: { ...prepared.attempt, status: 'accepted', providerMediaId, providerMessageId },
        message: { ...prepared.message, channelMessageId: providerMessageId, metadata: { ...prepared.message.metadata, mediaId: providerMediaId, providerStatus: 'accepted', providerAccepted: true } },
      }, true)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/conversations/:id/send-media-asset',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const idempotencyKey = readIdempotencyKey(request)
      if (!idempotencyKey) return reply.code(400).send({ error: 'A valid Idempotency-Key header is required' })

      const existing = await withDb((sql) => createMediaAssetsRepository(sql).findOutboundAttempt(clinicId, request.params.id, idempotencyKey))
      if (existing) return attemptResponse(reply, existing)
      const parsed = storedAssetSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid media asset request' })

      const resolved = await withDb(async (sql) => {
        const conversation = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!conversation) return { code: 404 as const }
        if (conversation.channel !== 'whatsapp') return { code: 400 as const }
        const asset = await createMediaAssetsRepository(sql).findById(clinicId, parsed.data.assetId)
        if (!asset || asset.deletedAt || asset.storageStatus !== 'active') return { code: 404 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((candidate) => candidate.channel === 'whatsapp' && candidate.status === 'active')
        const token = readChannelToken(account?.accessTokenEnc)
        if (!account || !token) return { code: 502 as const }
        return { code: 200 as const, conversation, asset, account, token }
      })
      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation or media asset not found' })
      if (resolved.code === 400) return reply.code(400).send({ error: 'Media can only be sent on WhatsApp' })
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })
      if (!isEligibleWhatsAppMediaAsset(resolved.asset)) return reply.code(400).send({ error: 'WhatsApp media must be a PDF up to 100 MB or a JPEG/PNG image up to 5 MB' })

      const bytes = await readKbVaultObject(resolved.asset.storageKey)
      if (!bytes) return reply.code(503).send({ error: 'Private media storage is not configured' })
      const storedValidationError = validateMediaAsset({ contentType: resolved.asset.contentType, byteSize: bytes.byteLength, signatureBytes: bytes.subarray(0, 512) })
      if (storedValidationError || bytes.byteLength !== resolved.asset.byteSize) return reply.code(400).send({ error: 'Stored media content does not match its declared type' })
      if (!isEligibleWhatsAppMediaAsset({ contentType: resolved.asset.contentType, byteSize: bytes.byteLength })) return reply.code(400).send({ error: 'WhatsApp media must be a PDF up to 100 MB or a JPEG/PNG image up to 5 MB' })

      const caption = parsed.data.caption || undefined
      const prepared = await withDb((sql) => createMediaAssetsRepository(sql).prepareOutbound({
        clinicId,
        conversationId: request.params.id,
        mediaAssetId: resolved.asset.id,
        idempotencyKey,
        authorId: request.user!.userId,
        content: caption ?? (resolved.asset.contentType === 'application/pdf' ? resolved.asset.filename : ''),
        contentType: resolved.asset.contentType === 'application/pdf' ? 'document' : 'image',
        metadata: { authorId: request.user!.userId, mediaAssetId: resolved.asset.id, mimeType: resolved.asset.contentType, filename: resolved.asset.filename },
      }))
      if (!prepared.created) return attemptResponse(reply, prepared)

      let providerMediaId: string | undefined
      let providerMessageId: string | undefined
      try {
        providerMediaId = await uploadWhatsAppMedia(resolved.account.accountId, resolved.token, bytes, resolved.asset.contentType, resolved.asset.filename)
        const sentId = resolved.asset.contentType === 'application/pdf'
          ? await sendWhatsAppDocument(resolved.account.accountId, resolved.token, resolved.conversation.channelContactHandle, providerMediaId, resolved.asset.filename, caption)
          : await sendWhatsAppImage(resolved.account.accountId, resolved.token, resolved.conversation.channelContactHandle, providerMediaId, caption)
        if (!sentId) throw new Error('Provider accepted no message identifier')
        providerMessageId = sentId
      } catch {
        await markUncertain(request, clinicId, prepared.attempt.id, PROVIDER_OUTCOME_UNCERTAIN, providerMediaId, providerMessageId)
        return reply.code(202).send({ status: 'uncertain', retryable: false, attemptId: prepared.attempt.id, message: prepared.message })
      }

      try {
        await withDb((sql) => createMediaAssetsRepository(sql).markOutboundAccepted({ clinicId, attemptId: prepared.attempt.id, providerMessageId, providerMediaId }))
      } catch {
        await markUncertain(request, clinicId, prepared.attempt.id, ACCEPTANCE_RECONCILIATION_FAILED, providerMediaId, providerMessageId)
        return reply.code(202).send({ status: 'uncertain', retryable: false, attemptId: prepared.attempt.id, message: prepared.message })
      }
      return attemptResponse(reply, {
        ...prepared,
        attempt: { ...prepared.attempt, status: 'accepted', providerMediaId, providerMessageId },
        message: { ...prepared.message, channelMessageId: providerMessageId, metadata: { ...prepared.message.metadata, mediaId: providerMediaId, providerStatus: 'accepted', providerAccepted: true } },
      }, true)
    },
  )
}

export default conversationMediaRoute
