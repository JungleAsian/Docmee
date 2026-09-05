import Fastify from 'fastify'
import { Readable } from 'node:stream'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const h = vi.hoisted(() => ({
  clinic: { id: 'clinic-1', settings: {} as Record<string, unknown> },
  listFiles: vi.fn(),
  getFile: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
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
  GOOGLE_DRIVE_FILE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
  createGoogleDriveOps: () => ({ listFiles: h.listFiles, getFile: h.getFile, downloadFile: h.downloadFile, uploadFile: h.uploadFile }),
}))
vi.mock('../lib/kb-vault-storage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/kb-vault-storage.js')>()),
  kbVaultEnabled: () => true,
  MEDIA_ASSET_MAX_BYTES: 16,
}))
vi.mock('../lib/media-asset-ingest.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/media-asset-ingest.js')>()),
  ingestMediaAssetFromPath: h.ingest,
}))

import { signAccessToken } from '../auth/jwt.js'
import googleDriveMediaRoute, { removeDriveUploadTempFile } from './google-drive-media.js'

const BOUNDARY = '----docmeedriveuploadboundary'
function multipartFile(bytes: Uint8Array = PNG_BYTES, type = 'image/png', extra = false) {
  const parts = [
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="repository.png"\r\nContent-Type: ${type}\r\n\r\n`, 'utf8'),
    Buffer.from(bytes),
    Buffer.from(extra
      ? `\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="extra"\r\n\r\nnope\r\n--${BOUNDARY}--\r\n`
      : `\r\n--${BOUNDARY}--\r\n`, 'utf8'),
  ]
  return Buffer.concat(parts)
}

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
    h.uploadFile.mockResolvedValue({ id: 'drive-new', name: 'repository.png', mimeType: 'image/png', byteSize: 8, modifiedTime: null, webViewLink: null })
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

  it('reports browse and upload authorization independently', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] } }
    const response = await app.inject({ method: 'GET', url: '/clinics/clinic-1/media/google-drive', headers: auth })
    expect(response.json()).toMatchObject({ browseAuthorized: true, uploadAuthorized: false, reconnectRequired: true })
  })

  it('uploads one validated file to Drive only with create permission', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.file'] } }
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartFile() })
    expect(response.statusCode, response.body).toBe(201)
    expect(response.json()).toEqual({ file: expect.objectContaining({ id: 'drive-new', name: 'repository.png' }) })
    expect(h.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'repository.png', mimeType: 'image/png', body: expect.anything() }))
  })

  it.each([
    ['missing create consent', PNG_BYTES, 'image/png', false, ['https://www.googleapis.com/auth/drive.readonly'], 409],
    ['empty file', new Uint8Array(), 'image/png', false, ['https://www.googleapis.com/auth/drive.file'], 400],
    ['unsupported MIME', PNG_BYTES, 'text/plain', false, ['https://www.googleapis.com/auth/drive.file'], 400],
    ['mismatched signature', new TextEncoder().encode('not-png'), 'image/png', false, ['https://www.googleapis.com/auth/drive.file'], 400],
    ['extra multipart field', PNG_BYTES, 'image/png', true, ['https://www.googleapis.com/auth/drive.file'], 400],
  ])('rejects %s before calling Google', async (_label, bytes, type, extra, scopes, status) => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes } }
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartFile(new Uint8Array(bytes as Uint8Array), type as string, extra as boolean) })
    expect(response.statusCode, response.body).toBe(status)
    expect(h.uploadFile).not.toHaveBeenCalled()
  })

  it('does not call Google for an unauthenticated or cross-clinic upload', async () => {
    const headers = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
    expect((await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers, payload: multipartFile() })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/clinics/clinic-2/media/google-drive/upload', headers: { ...headers, ...auth }, payload: multipartFile() })).statusCode).toBe(404)
    expect(h.uploadFile).not.toHaveBeenCalled()
  })

  it('reports an uncertain provider failure without retrying', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.file'] } }
    h.uploadFile.mockRejectedValueOnce(new Error('socket closed'))
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartFile() })
    expect(response.statusCode).toBe(502)
    expect(response.json()).toMatchObject({ uploadUncertain: true, retryable: false })
    expect(h.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('destroys a rejected upload stream and removes its temporary file before responding', async () => {
    const realRemove = fs.rm.bind(fs)
    const removeSpy = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return realRemove(...args)
    })
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.file'] } }
    const before = new Set((await fs.readdir(tmpdir())).filter((name) => name.startsWith('docmee-drive-upload-')))
    let providerBody: Readable | undefined
    h.uploadFile.mockImplementationOnce(async ({ body }: { body: Readable }) => {
      providerBody = body
      throw new Error('rejected before reading')
    })
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartFile() })
    const after = (await fs.readdir(tmpdir())).filter((name) => name.startsWith('docmee-drive-upload-') && !before.has(name))
    removeSpy.mockRestore()
    expect(response.statusCode).toBe(502)
    expect(providerBody?.destroyed).toBe(true)
    expect(after).toEqual([])
  })

  it('retries an initial unlink failure and eventually removes the exact temporary file', async () => {
    const path = `${tmpdir()}/docmee-drive-upload-retry-${Date.now()}`
    await fs.writeFile(path, PNG_BYTES)
    const errors: string[] = []
    let attempts = 0
    const removed = await removeDriveUploadTempFile(
      path,
      (message) => errors.push(message),
      async (target) => {
        attempts += 1
        expect(target).toBe(path)
        if (attempts === 1) throw new Error('file temporarily busy')
        await fs.rm(target, { force: true })
      },
      async () => undefined,
    )
    expect(removed).toBe(true)
    expect(attempts).toBe(2)
    expect(errors).toEqual([expect.stringContaining('cleanup retry scheduled')])
    await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an oversized upload before calling Google', async () => {
    h.clinic.settings = { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.file'] } }
    const bytes = new Uint8Array([...PNG_BYTES, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media/google-drive/upload', headers: { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartFile(bytes) })
    expect(response.statusCode, response.body).toBe(413)
    expect(h.uploadFile).not.toHaveBeenCalled()
  })

  it('exposes no source deletion operation', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/clinics/clinic-1/media/google-drive/drive-1', headers: auth })
    expect(response.statusCode).toBe(404)
    expect(h.uploadFile).not.toHaveBeenCalled()
  })
})
