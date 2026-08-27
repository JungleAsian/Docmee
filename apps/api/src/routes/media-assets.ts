import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createMediaAssetsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import {
  createKbVaultDownloadUrl,
  deleteKbVaultObject,
  kbVaultEnabled,
  MEDIA_ASSET_MAX_ACTIVE_FILES,
  MEDIA_ASSET_MAX_BYTES,
  MEDIA_ASSET_QUOTA_BYTES,
  mediaObjectKey,
  uploadKbVaultObject,
  validateMediaAsset,
} from '../lib/kb-vault-storage.js'

function toMediaAssetSummary(asset: {
  id: string
  filename: string
  contentType: string
  byteSize: number
  createdAt: string
}) {
  return {
    id: asset.id,
    filename: asset.filename,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    createdAt: asset.createdAt,
  }
}

async function readPrefix(path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of createReadStream(path, { start: 0, end: 511 })) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const mediaAssetsRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MEDIA_ASSET_MAX_BYTES } })
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const assets = await withDb((sql) => createMediaAssetsRepository(sql).list(clinicId))
    return {
      storageConfigured: kbVaultEnabled(),
      assets: assets.slice(0, MEDIA_ASSET_MAX_ACTIVE_FILES).map(toMediaAssetSummary),
    }
  })

  app.post<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })
    const file = await request.file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    const tempPath = join(tmpdir(), `docmee-media-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    try {
      await pipeline(file.file, createWriteStream(tempPath, { flags: 'wx' }))
      const stat = await fs.stat(tempPath)
      const validationError = validateMediaAsset({
        contentType: file.mimetype,
        byteSize: stat.size,
        signatureBytes: await readPrefix(tempPath),
      })
      if (validationError === 'empty') return reply.code(400).send({ error: 'Empty files are not allowed' })
      if (validationError === 'too_large') return reply.code(413).send({ error: 'File exceeds the 100 MB limit' })
      if (validationError === 'unsupported_type') return reply.code(400).send({ error: 'Only PDF, JPEG, PNG, and WebP files are supported' })
      if (validationError === 'invalid_signature') return reply.code(400).send({ error: 'File content does not match its declared type' })
      const checksumHash = createHash('sha256')
      for await (const chunk of createReadStream(tempPath)) checksumHash.update(chunk)
      const checksum = checksumHash.digest('hex')
      const key = mediaObjectKey({ clinicId, assetId: randomUUID(), fileName: file.filename || 'attachment' })
      await uploadKbVaultObject({ key, body: createReadStream(tempPath), contentType: file.mimetype, metadata: { clinicId, checksum } })
      let asset
      try {
        asset = await withDb((sql) => createMediaAssetsRepository(sql).createWithinQuota({ clinicId, uploadedBy: request.user!.userId, filename: file.filename || 'attachment', contentType: file.mimetype as never, byteSize: stat.size, checksum, storageKey: key }, { maxFiles: MEDIA_ASSET_MAX_ACTIVE_FILES, maxBytes: MEDIA_ASSET_QUOTA_BYTES }))
      } catch (error) {
        await deleteKbVaultObject(key).catch((cleanupError) => {
          request.log.error(`[media-assets] failed to clean up rejected upload: ${(cleanupError as Error).message}`)
        })
        if (error instanceof Error && error.message === 'media_file_limit_reached') return reply.code(413).send({ error: 'Clinic media file limit reached (10 active files)' })
        if (error instanceof Error && error.message === 'media_quota_exceeded') return reply.code(413).send({ error: 'Clinic media quota exceeded' })
        throw error
      }
      return reply.code(201).send({ asset: toMediaAssetSummary(asset) })
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  })

  app.get<{ Params: { id: string; assetId: string } }>('/clinics/:id/media/:assetId/download', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const asset = await withDb((sql) => createMediaAssetsRepository(sql).findById(clinicId, request.params.assetId))
    if (!asset || asset.deletedAt) return reply.code(404).send({ error: 'Media asset not found' })
    const url = await createKbVaultDownloadUrl(asset.storageKey, asset.filename)
    if (!url) return reply.code(503).send({ error: 'Private media storage is not configured' })
    return { url, expiresInSeconds: 300 }
  })

  app.delete<{ Params: { id: string; assetId: string } }>('/clinics/:id/media/:assetId', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const deleted = await withDb((sql) => createMediaAssetsRepository(sql).softDelete(clinicId, request.params.assetId))
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'Media asset not found' })
  })
}

export default mediaAssetsRoute
