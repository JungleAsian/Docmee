import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { createWriteStream, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGoogleDriveOps, GOOGLE_DRIVE_READONLY_SCOPE, type GoogleDriveConfig } from '@docmee/agents'
import { createClinicsRepository } from '@docmee/db'
import { decryptValue, encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { isDocmeeExpansionFeatureEnabled } from '../lib/features.js'
import { kbVaultEnabled, MEDIA_ASSET_MAX_BYTES } from '../lib/kb-vault-storage.js'
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
      if (!connection) return { connected: false, authorized: false, reconnectRequired: false, files: [] }
      if (!hasDriveScope(connection)) return { connected: true, authorized: false, reconnectRequired: true, files: [] }
      const query = request.query.query?.trim().slice(0, 200)
      const pageToken = request.query.pageToken?.trim().slice(0, 2048)
      try {
        const result = await (await driveOps(clinicId, connection)).listFiles({
          ...(query ? { query } : {}),
          ...(pageToken ? { pageToken } : {}),
          pageSize: 20,
        })
        return { connected: true, authorized: true, reconnectRequired: false, ...result }
      } catch (error) {
        request.log.error(`[google-drive] list failed: ${(error as Error).message}`)
        return googleProviderError(reply, error)
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
