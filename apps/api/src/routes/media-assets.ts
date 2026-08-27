import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { createHash } from 'node:crypto'
import { createMediaAssetsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { createKbVaultDownloadUrl, mediaObjectKey, uploadKbVaultObject, kbVaultEnabled } from '../lib/kb-vault-storage.js'

const MAX_BYTES = 100 * 1024 * 1024
const MAX_ACTIVE_FILES = 10
const QUOTA_BYTES = 100 * 1024 * 1024
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const)

function hasValidSignature(type: string, buffer: Buffer) {
  if (type === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

const mediaAssetsRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES } })
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const assets = await withDb((sql) => createMediaAssetsRepository(sql).list(clinicId))
    return { assets }
  })

  app.post<{ Params: { id: string } }>('/clinics/:id/media', { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') }, async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })
    const file = await request.file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    if (!TYPES.has(file.mimetype as never)) return reply.code(400).send({ error: 'Only PDF, JPEG, PNG, and WebP files are supported' })
    let buffer: Buffer
    try { buffer = await file.toBuffer() } catch { return reply.code(413).send({ error: 'File exceeds the 100 MB limit' }) }
    if (buffer.length === 0) return reply.code(400).send({ error: 'Empty files are not allowed' })
    if (!hasValidSignature(file.mimetype, buffer)) return reply.code(400).send({ error: 'File content does not match its declared type' })
    const usage = await withDb(async (sql) => {
      const repo = createMediaAssetsRepository(sql)
      return { bytes: await repo.activeBytes(clinicId), count: await repo.activeCount(clinicId) }
    })
    if (usage.count >= MAX_ACTIVE_FILES) return reply.code(413).send({ error: 'Clinic media file limit reached (10 active files)' })
    const used = usage.bytes
    if (used + buffer.length > QUOTA_BYTES) return reply.code(413).send({ error: 'Clinic media quota exceeded' })
    const checksum = createHash('sha256').update(buffer).digest('hex')
    const key = mediaObjectKey({ clinicId, assetId: checksum.slice(0, 24), fileName: file.filename || 'attachment' })
    await uploadKbVaultObject({ key, body: buffer, contentType: file.mimetype, metadata: { clinicId, checksum } })
    const asset = await withDb((sql) => createMediaAssetsRepository(sql).create({ clinicId, uploadedBy: request.user!.userId, filename: file.filename || 'attachment', contentType: file.mimetype as never, byteSize: buffer.length, checksum, storageKey: key }))
    return reply.code(201).send({ asset })
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
