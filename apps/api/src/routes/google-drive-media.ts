import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGoogleDriveOps, GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_DRIVE_READONLY_SCOPE, type GoogleDriveConfig } from '@docmee/agents'
import { createClinicsRepository } from '@docmee/db'
import { decryptValue, encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { isDocmeeExpansionFeatureEnabled } from '../lib/features.js'
import { kbVaultEnabled, MEDIA_ASSET_MAX_BYTES, validateMediaAsset } from '../lib/kb-vault-storage.js'
import {
  ingestMediaAssetFromPath,
  MediaAssetIngestError,
  mediaAssetIngestHttpError,
} from '../lib/media-asset-ingest.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

interface StoredGoogleConnection {
  accessToken: string
  refreshToken: string
  expiryDate?: number
  scopes: string[]
}

const TEMP_CLEANUP_BACKOFF_MS = [10, 50, 200] as const

export async function removeDriveUploadTempFile(
  path: string,
  logFailure: (message: string) => void,
  remove: (path: string) => Promise<unknown> = (target) => fs.rm(target, { force: true }),
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<boolean> {
  for (let attempt = 0; attempt < TEMP_CLEANUP_BACKOFF_MS.length; attempt += 1) {
    try {
      await remove(path)
      return true
    } catch (error) {
      const finalAttempt = attempt === TEMP_CLEANUP_BACKOFF_MS.length - 1
      logFailure(`[google-drive] ${finalAttempt ? 'SECURITY: temp media cleanup exhausted' : 'temp media cleanup retry scheduled'} for ${path}: ${(error as Error).message}`)
      if (!finalAttempt) await wait(TEMP_CLEANUP_BACKOFF_MS[attempt]!)
    }
  }
  return false
}

function toMediaAssetSummary(asset: {
  id: string
  filename: string
  contentType: string
  byteSize: number
  storageStatus: string
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

function storedGoogleConnection(settings: Record<string, unknown>): StoredGoogleConnection | null {
  const value = settings['googleCalendar']
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record['accessToken'] !== 'string' || typeof record['refreshToken'] !== 'string') return null
  return {
    accessToken: record['accessToken'],
    refreshToken: record['refreshToken'],
    ...(typeof record['expiryDate'] === 'number' ? { expiryDate: record['expiryDate'] } : {}),
    scopes: Array.isArray(record['scopes']) ? record['scopes'].filter((scope): scope is string => typeof scope === 'string') : [],
  }
}

function hasDriveScope(connection: StoredGoogleConnection): boolean {
  return connection.scopes.includes(GOOGLE_DRIVE_READONLY_SCOPE)
    || connection.scopes.includes('https://www.googleapis.com/auth/drive')
}

function hasDriveUploadScope(connection: StoredGoogleConnection): boolean {
  return connection.scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)
    || connection.scopes.includes('https://www.googleapis.com/auth/drive')
}

async function loadClinic(clinicId: string) {
  return withDb((sql) => createClinicsRepository(sql).findById(clinicId))
}

async function driveOps(clinicId: string, connection: StoredGoogleConnection) {
  const config: GoogleDriveConfig = {
    accessToken: decryptValue(connection.accessToken),
    refreshToken: decryptValue(connection.refreshToken),
    ...(typeof connection.expiryDate === 'number' ? { expiryDate: connection.expiryDate } : {}),
    onTokensRefreshed: async (tokens) => {
      await withDb(async (sql) => {
        const clinics = createClinicsRepository(sql)
        const latest = await clinics.findById(clinicId)
        if (!latest) return
        const current = storedGoogleConnection(latest.settings)
        if (!current) return
        await clinics.update(clinicId, {
          settings: {
            ...latest.settings,
            googleCalendar: {
              ...(latest.settings['googleCalendar'] as Record<string, unknown>),
              accessToken: encryptValue(tokens.accessToken),
              refreshToken: tokens.refreshToken ? encryptValue(tokens.refreshToken) : current.refreshToken,
              ...(typeof tokens.expiryDate === 'number' ? { expiryDate: tokens.expiryDate } : {}),
            },
          },
        })
      })
    },
  }
  return createGoogleDriveOps(config)
}

function googleProviderError(reply: FastifyReply, error: unknown) {
  const status = typeof error === 'object' && error !== null && 'code' in error ? Number((error as { code: unknown }).code) : 0
  if (status === 401 || status === 403) {
    return reply.code(409).send({ error: 'Google Drive authorization must be refreshed', reconnectRequired: true })
  }
  return reply.code(502).send({ error: 'Google Drive is temporarily unavailable' })
}

class DownloadLimitError extends Error {}

const DRIVE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024

function byteLimit(maxBytes: number) {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      callback(total > maxBytes ? new DownloadLimitError('Provider file exceeds the import limit') : null, chunk)
    },
  })
}

async function readBoundedPreview(source: NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.length
    if (total > maxBytes) throw new DownloadLimitError('Provider preview exceeds the preview limit')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

const googleDriveMediaRoute: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MEDIA_ASSET_MAX_BYTES } })
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', async (request, reply) => {
    const requestedClinicId = (request.params as { id?: string } | undefined)?.id
    const clinicId = resolveClinicScope(request, requestedClinicId)
    if (!clinicId || !(await isDocmeeExpansionFeatureEnabled('mediaRepository', clinicId))) {
      return reply.code(404).send({ error: 'Not found' })
    }
  })

  app.get<{ Params: { id: string }; Querystring: { query?: string; pageToken?: string } }>(
    '/clinics/:id/media/google-drive',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await loadClinic(clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const connection = storedGoogleConnection(clinic.settings)
      if (!connection) return { connected: false, authorized: false, browseAuthorized: false, uploadAuthorized: false, reconnectRequired: false, files: [] }
      const browseAuthorized = hasDriveScope(connection)
      const uploadAuthorized = hasDriveUploadScope(connection)
      if (!browseAuthorized) return { connected: true, authorized: false, browseAuthorized, uploadAuthorized, reconnectRequired: true, files: [] }
      const query = request.query.query?.trim().slice(0, 200)
      const pageToken = request.query.pageToken?.trim().slice(0, 2048)
      try {
        const result = await (await driveOps(clinicId, connection)).listFiles({
          ...(query ? { query } : {}),
          ...(pageToken ? { pageToken } : {}),
          pageSize: 20,
        })
        return { connected: true, authorized: true, browseAuthorized, uploadAuthorized, reconnectRequired: !uploadAuthorized, ...result }
      } catch (error) {
        request.log.error(`[google-drive] list failed: ${(error as Error).message}`)
        return googleProviderError(reply, error)
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/media/google-drive/upload',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await loadClinic(clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const connection = storedGoogleConnection(clinic.settings)
      if (!connection || !hasDriveUploadScope(connection)) {
        return reply.code(409).send({ error: 'Reconnect Google to allow creating new Drive files', reconnectRequired: true })
      }

      const tempPath = join(tmpdir(), `docmee-drive-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      let providerStream: ReturnType<typeof createReadStream> | null = null
      try {
        let uploadedPart: { filename: string; mimetype: string; truncated: boolean } | null = null
        let partCount = 0
        for await (const part of request.parts()) {
          partCount += 1
          if (part.type !== 'file' || uploadedPart || partCount > 1) {
            if (part.type === 'file') part.file.resume()
            continue
          }
          await pipeline(part.file, createWriteStream(tempPath, { flags: 'wx' }))
          uploadedPart = { filename: part.filename, mimetype: part.mimetype, truncated: part.file.truncated }
        }
        if (!uploadedPart || partCount !== 1) {
          reply.code(400)
          return { error: 'Upload exactly one file' }
        }
        if (uploadedPart.truncated) {
          reply.code(413)
          return { error: 'File exceeds the 100 MB limit' }
        }
        const stat = await fs.stat(tempPath)
        const handle = await fs.open(tempPath, 'r')
        const signature = Buffer.alloc(12)
        let bytesRead = 0
        try {
          ;({ bytesRead } = await handle.read(signature, 0, signature.length, 0))
        } finally {
          await handle.close()
        }
        const validation = validateMediaAsset({ contentType: uploadedPart.mimetype, byteSize: stat.size, signatureBytes: signature.subarray(0, bytesRead) })
        if (validation) {
          const status = validation === 'too_large' ? 413 : 400
          reply.code(status)
          return { error: validation === 'too_large' ? 'File exceeds the 100 MB limit' : 'Choose a non-empty PDF, JPEG, PNG, or WebP file whose content matches its type' }
        }
        providerStream = createReadStream(tempPath)
        const uploaded = await (await driveOps(clinicId, connection)).uploadFile({
          name: uploadedPart.filename || 'attachment',
          mimeType: uploadedPart.mimetype as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp',
          body: providerStream,
        })
        // Return the payload so Fastify sends it only after finally finishes.
        reply.code(201)
        return { file: uploaded }
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
          reply.code(413)
          return { error: 'File exceeds the 100 MB limit' }
        }
        request.log.error(`[google-drive] create upload may be uncertain: ${(error as Error).message}`)
        reply.code(502)
        return { error: 'Google Drive upload outcome is uncertain; check Drive before trying again', uploadUncertain: true, retryable: false }
      } finally {
        if (providerStream && !providerStream.destroyed) providerStream.destroy()
        if (providerStream && !providerStream.closed) await once(providerStream, 'close')
        await removeDriveUploadTempFile(tempPath, (message) => request.log.error(message))
      }
    },
  )

  app.post<{ Params: { id: string; fileId: string } }>(
    '/clinics/:id/media/google-drive/:fileId/import',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      if (!kbVaultEnabled()) return reply.code(503).send({ error: 'Private media storage is not configured' })
      const clinic = await loadClinic(clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const connection = storedGoogleConnection(clinic.settings)
      if (!connection || !hasDriveScope(connection)) {
        return reply.code(409).send({ error: 'Connect Google Drive before importing files', reconnectRequired: true })
      }

      const ops = await driveOps(clinicId, connection)
      let metadata
      try {
        metadata = await ops.getFile(request.params.fileId)
      } catch (error) {
        request.log.error(`[google-drive] metadata failed: ${(error as Error).message}`)
        return googleProviderError(reply, error)
      }
      if (!metadata) return reply.code(404).send({ error: 'Google Drive file not found or unsupported' })
      if (metadata.byteSize > MEDIA_ASSET_MAX_BYTES) return reply.code(413).send({ error: 'File exceeds the 100 MB limit' })

      const tempPath = join(tmpdir(), `docmee-drive-${Date.now()}-${Math.random().toString(16).slice(2)}`)
      try {
        const source = await ops.downloadFile(metadata.id)
        await pipeline(source, byteLimit(MEDIA_ASSET_MAX_BYTES), createWriteStream(tempPath, { flags: 'wx' }))
        const asset = await ingestMediaAssetFromPath({
          clinicId,
          uploadedBy: request.user!.userId,
          filename: metadata.name,
          contentType: metadata.mimeType,
          tempPath,
          logError: (message) => request.log.error(message),
        })
        return reply.code(201).send({ asset: toMediaAssetSummary(asset) })
      } catch (error) {
        if (error instanceof DownloadLimitError) return reply.code(413).send({ error: 'File exceeds the 100 MB limit' })
        if (error instanceof MediaAssetIngestError) {
          const httpError = mediaAssetIngestHttpError(error)
          return reply.code(httpError.status).send({ error: httpError.message })
        }
        request.log.error(`[google-drive] import failed: ${(error as Error).message}`)
        return googleProviderError(reply, error)
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => undefined)
      }
    },
  )

  app.get<{ Params: { id: string; fileId: string } }>(
    '/clinics/:id/media/google-drive/:fileId/preview',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin', 'secretary', 'doctor') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await loadClinic(clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const connection = storedGoogleConnection(clinic.settings)
      if (!connection || !hasDriveScope(connection)) {
        return reply.code(409).send({ error: 'Connect Google Drive before previewing files', reconnectRequired: true })
      }
      const ops = await driveOps(clinicId, connection)
      try {
        const metadata = await ops.getFile(request.params.fileId)
        if (!metadata) return reply.code(404).send({ error: 'Google Drive file not found or unsupported' })
        if (!metadata.mimeType.startsWith('image/')) return reply.code(400).send({ error: 'Inline preview is available for images only' })
        if (metadata.byteSize > DRIVE_PREVIEW_MAX_BYTES) return reply.code(413).send({ error: 'Image is too large to preview; import it to Docmee instead' })
        const preview = await readBoundedPreview(await ops.downloadFile(metadata.id), DRIVE_PREVIEW_MAX_BYTES)
        return reply
          .type(metadata.mimeType)
          .header('content-disposition', 'inline')
          .send(preview)
      } catch (error) {
        if (error instanceof DownloadLimitError) return reply.code(413).send({ error: 'Image is too large to preview; import it to Docmee instead' })
        request.log.error(`[google-drive] preview failed: ${(error as Error).message}`)
        return googleProviderError(reply, error)
      }
    },
  )
}

export default googleDriveMediaRoute
