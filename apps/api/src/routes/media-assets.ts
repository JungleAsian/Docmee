import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createMediaAssetsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { createKbVaultDownloadUrl, mediaObjectKey, uploadKbVaultObject, kbVaultEnabled } from '../lib/kb-vault-storage.js'

const MAX_BYTES = 100 * 1024 * 1024
const MAX_ACTIVE_FILES = 10
const QUOTA_BYTES = 100 * 1024 * 1024
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const)

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

function hasValidSignature(type: string, buffer: Buffer) {
  if (type === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

async function readPrefix(path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of createReadStream(path, { start: 0, end: 511 })) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

const mediaAssetsRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES } })
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const assets = await withDb((sql) => createMediaAssetsRepository(sql).list(clinicId))
    return {
      storageConfigured: kbVaultEnabled(),
      assets: assets.slice(0, MAX_ACTIVE_FILES).map(toMediaAssetSummary),
    }
  })

  app.post<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })
    const file = await request.file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    if (!TYPES.has(file.mimetype as never)) return reply.code(400).send({ error: 'Only PDF, JPEG, PNG, and WebP files are supported' })
    const tempPath = join(tmpdir(), `docmee-media-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    try {
      await pipeline(file.file, createWriteStream(tempPath, { flags: 'wx' }))
      const stat = await fs.stat(tempPath)
      if (stat.size === 0) return reply.code(400).send({ error: 'Empty files are not allowed' })
      if (stat.size > MAX_BYTES) return reply.code(413).send({ error: 'File exceeds the 100 MB limit' })
      const checksumHash = createHash('sha256')
      for await (const chunk of createReadStream(tempPath)) checksumHash.update(chunk)
      const checksum = checksumHash.digest('hex')
      if (!hasValidSignature(file.mimetype, await readPrefix(tempPath))) return reply.code(400).send({ error: 'File content does not match its declared type' })
      const key = mediaObjectKey({ clinicId, assetId: checksum.slice(0, 24), fileName: file.filename || 'attachment' })
      await uploadKbVaultObject({ key, body: createReadStream(tempPath), contentType: file.mimetype, metadata: { clinicId, checksum } })
      let asset
      try {
        asset = await withDb((sql) => createMediaAssetsRepository(sql).createWithinQuota({ clinicId, uploadedBy: request.user!.userId, filename: file.filename || 'attachment', contentType: file.mimetype as never, byteSize: stat.size, checksum, storageKey: key }, { maxFiles: MAX_ACTIVE_FILES, maxBytes: QUOTA_BYTES }))
      } catch (error) {
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
