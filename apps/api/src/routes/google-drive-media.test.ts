import Fastify from 'fastify'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const h = vi.hoisted(() => ({
  clinic: { id: 'clinic-1', settings: {} as Record<string, unknown> },
  listFiles: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  ingest: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({ findById: async () => h.clinic }),
}))
vi.mock('../lib/db.js', () => ({ withDb: async (callback: (sql: unknown) => unknown) => callback({}) }))
vi.mock('../lib/features.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/features.js')>()),
  isDocmeeExpansionFeatureEnabled: async () => true,
}))
vi.mock('@docmee/shared', () => ({ decryptValue: (value: string) => value.replace(/^enc:/, '') }))
vi.mock('@docmee/agents', () => ({
  GOOGLE_DRIVE_READONLY_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
  createGoogleDriveOps: () => ({ listFiles: h.listFiles, getFile: h.getFile, downloadFile: h.downloadFile }),
}))
vi.mock('../lib/kb-vault-storage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/kb-vault-storage.js')>()),
  kbVaultEnabled: () => true,
}))
vi.mock('../lib/media-asset-ingest.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/media-asset-ingest.js')>()),
  ingestMediaAssetFromPath: h.ingest,
}))

import { signAccessToken } from '../auth/jwt.js'
import googleDriveMediaRoute from './google-drive-media.js'

describe('Google Drive media routes', () => {
  const auth = { authorization: `Bearer ${signAccessToken({ userId: 'secretary-1', clinicId: 'clinic-1', role: 'secretary', email: 'secretary@test.local' })}` }
  const app = Fastify()

  beforeAll(async () => { await app.register(googleDriveMediaRoute); await app.ready() })
  afterAll(() => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    h.clinic = { id: 'clinic-1', settings: {} }
    h.listFiles.mockResolvedValue({ files: [], nextPageToken: null })
    h.getFile.mockResolvedValue({ id: 'drive-1', name: 'scan.png', mimeType: 'image/png', byteSize: PNG_BYTES.byteLength, modifiedTime: null, webViewLink: null })
    h.downloadFile.mockResolvedValue(Readable.from([Buffer.from(PNG_BYTES)]))
    h.ingest.mockResolvedValue({
      id: 'asset-1',
      filename: 'scan.png',
      contentType: 'image/png',
      byteSize: PNG_BYTES.byteLength,
      storageKey: 'private/clinic-1/internal-key',
      checksumSha256: 'internal-checksum',
      createdAt: '2026-08-27T00:00:00.000Z',
    })
  })

  it('requires a one-time reconnect when the existing clinic token lacks Drive scope', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/calendar.events'] } }
    const response = await app.inject({ method: 'GET', url: '/clinics/clinic-1/media/google-drive', headers: auth })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ connected: true, authorized: false, reconnectRequired: true, files: [] })
    expect(h.listFiles).not.toHaveBeenCalled()
  })

  it('lists only normalized Drive media through the clinic-scoped connection', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] } }
    h.listFiles.mockResolvedValue({ files: [{ id: 'drive-1', name: 'scan.png', mimeType: 'image/png', byteSize: 8, modifiedTime: null, webViewLink: 'https://drive.google.com/file/d/drive-1/view' }], nextPageToken: 'next-1' })
    const response = await app.inject({ method: 'GET', url: '/clinics/clinic-1/media/google-drive?query=scan', headers: auth })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ connected: true, authorized: true, nextPageToken: 'next-1', files: [{ id: 'drive-1', name: 'scan.png' }] })
    expect(h.listFiles).toHaveBeenCalledWith({ query: 'scan', pageToken: undefined, pageSize: 20 })
  })

  it('downloads a selected Drive file server-side and imports it through the private repository boundary', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] } }
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/drive-1/import', headers: auth })
    expect(response.statusCode, response.body).toBe(201)
    expect(h.getFile).toHaveBeenCalledWith('drive-1')
    expect(h.downloadFile).toHaveBeenCalledWith('drive-1')
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', uploadedBy: 'secretary-1', filename: 'scan.png', contentType: 'image/png' }))
    const payload = response.json()
    expect(payload).toMatchObject({ asset: { id: 'asset-1', filename: 'scan.png' } })
    expect(payload.asset).not.toHaveProperty('storageKey')
    expect(payload.asset).not.toHaveProperty('checksumSha256')
  })

  it('rejects oversized Drive metadata before downloading provider bytes', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] } }
    h.getFile.mockResolvedValue({ id: 'drive-1', name: 'huge.pdf', mimeType: 'application/pdf', byteSize: 100 * 1024 * 1024 + 1, modifiedTime: null, webViewLink: null })
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/drive-1/import', headers: auth })
    expect(response.statusCode).toBe(413)
    expect(h.downloadFile).not.toHaveBeenCalled()
    expect(h.ingest).not.toHaveBeenCalled()
  })

  it('proxies a bounded image preview through the authenticated API', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] } }
    const response = await app.inject({ method: 'GET', url: '/clinics/clinic-1/media/google-drive/drive-1/preview', headers: auth })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/png')
    expect(response.rawPayload).toEqual(Buffer.from(PNG_BYTES))
  })
})
