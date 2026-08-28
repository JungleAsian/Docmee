import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createMediaAssetsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { isDocmeeExpansionFeatureEnabled } from '../lib/features.js'
import {
  createKbVaultDownloadUrl,
  deleteKbVaultObject,
  kbVaultEnabled,
  MEDIA_ASSET_MAX_ACTIVE_FILES,
  MEDIA_ASSET_MAX_BYTES,
} from '../lib/kb-vault-storage.js'
import {
  ingestMediaAssetFromPath,
  MediaAssetIngestError,
  mediaAssetIngestHttpError,
} from '../lib/media-asset-ingest.js'

function toMediaAssetSummary(asset: {
  id: string
  filename: string
  contentType: string
  byteSize: number
  storageStatus: string
  storageFailureCode?: string | null
  createdAt: string
}) {
  return {
    id: asset.id,
    filename: asset.filename,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    storageStatus: asset.storageStatus,
    cleanupRequired: asset.storageStatus === 'delete_failed',
    createdAt: asset.createdAt,
  }
}

const mediaAssetsRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MEDIA_ASSET_MAX_BYTES } })
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', async (request, reply) => {
    const requestedClinicId = (request.params as { id?: string } | undefined)?.id
    const clinicId = resolveClinicScope(request, requestedClinicId)
    if (!clinicId || !(await isDocmeeExpansionFeatureEnabled('mediaRepository', clinicId))) {
      return reply.code(404).send({ error: 'Not found' })
    }
  })

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
      try {
        const asset = await ingestMediaAssetFromPath({
          clinicId,
          uploadedBy: request.user!.userId,
          filename: file.filename || 'attachment',
          contentType: file.mimetype,
          tempPath,
          logError: (message) => request.log.error(message),
        })
        return reply.code(201).send({ asset: toMediaAssetSummary(asset) })
      } catch (error) {
        if (error instanceof MediaAssetIngestError) {
          const httpError = mediaAssetIngestHttpError(error)
          return reply.code(httpError.status).send({ error: httpError.message })
        }
        throw error
      }
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
    }
  })

  app.get<{ Params: { id: string; assetId: string } }>('/clinics/:id/media/:assetId/download', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const asset = await withDb((sql) => createMediaAssetsRepository(sql).findById(clinicId, request.params.assetId))
    if (!asset || asset.deletedAt || asset.storageStatus !== 'active') return reply.code(404).send({ error: 'Media asset not found' })
    const url = await createKbVaultDownloadUrl(asset.storageKey, asset.filename)
    if (!url) return reply.code(503).send({ error: 'Private media storage is not configured' })
    return { url, expiresInSeconds: 300 }
  })

  app.delete<{ Params: { id: string; assetId: string } }>('/clinics/:id/media/:assetId', { preHandler: requireRole('clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const pending = await withDb((sql) => createMediaAssetsRepository(sql).beginDeletion(clinicId, request.params.assetId))
    if (!pending) return reply.code(404).send({ error: 'Media asset not found' })
    try {
      const deleted = await deleteKbVaultObject(pending.storageKey)
      if (!deleted) throw new Error('S3 storage is unavailable')
      await withDb((sql) => createMediaAssetsRepository(sql).markDeletionComplete(clinicId, request.params.assetId))
      return reply.code(204).send()
    } catch (error) {
      request.log.error(`[media-assets] object cleanup failed: ${(error as Error).message}`)
      await withDb((sql) => createMediaAssetsRepository(sql).markDeletionFailed(clinicId, request.params.assetId, 's3_delete_failed'))
      return reply.code(503).send({ error: 'Media cleanup pending', retryable: true })
    }
  })
}

export default mediaAssetsRoute
