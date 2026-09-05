import type { Auth } from 'googleapis'
import type { Readable } from 'node:stream'
import type { RefreshedTokens } from '../calbot/google-calendar-client.js'

type GoogleApi = (typeof import('googleapis'))['google']
let googlePromise: Promise<GoogleApi> | null = null

function loadGoogle(): Promise<GoogleApi> {
  if (!googlePromise) googlePromise = import('googleapis').then((module) => module.google)
  return googlePromise
}

export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const SUPPORTED_DRIVE_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  modifiedTime: string | null
  webViewLink: string | null
}

export interface GoogleDriveConfig {
  accessToken: string
  refreshToken: string
  expiryDate?: number
  onTokensRefreshed?: (tokens: RefreshedTokens) => void | Promise<void>
}

export function normalizeGoogleDriveFile(file: {
  id?: string | null
  name?: string | null
  mimeType?: string | null
  size?: string | null
  modifiedTime?: string | null
  webViewLink?: string | null
}): GoogleDriveFile | null {
  const id = file.id?.trim()
  const name = file.name?.trim()
  const byteSize = Number(file.size)
  if (!id || !name || !file.mimeType || !SUPPORTED_DRIVE_MEDIA_TYPES.has(file.mimeType)) return null
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) return null
  return {
    id,
    name,
    mimeType: file.mimeType as GoogleDriveFile['mimeType'],
    byteSize,
    modifiedTime: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
  }
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function buildGoogleDriveMediaQuery(search?: string): string {
  const mediaFilter = [...SUPPORTED_DRIVE_MEDIA_TYPES]
    .map((mimeType) => `mimeType = '${mimeType}'`)
    .join(' or ')
  const query = search?.trim()
  return `trashed = false and (${mediaFilter})${query ? ` and name contains '${escapeDriveQueryValue(query)}'` : ''}`
}

async function authedDrive(config: GoogleDriveConfig) {
  const google = await loadGoogle()
  const auth: Auth.OAuth2Client = new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI'],
  )
  auth.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
    expiry_date: config.expiryDate ?? 1,
  })
  if (config.onTokensRefreshed) {
    auth.on('tokens', (tokens) => {
      if (!tokens.access_token) return
      Promise.resolve(config.onTokensRefreshed!({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        expiryDate: tokens.expiry_date ?? undefined,
      })).catch((error) => console.error('[drive] failed to persist refreshed tokens', error))
    })
  }
  return google.drive({ version: 'v3', auth })
}

export interface GoogleDriveOps {
  listFiles(input: { query?: string; pageToken?: string; pageSize?: number }): Promise<{ files: GoogleDriveFile[]; nextPageToken: string | null }>
  getFile(fileId: string): Promise<GoogleDriveFile | null>
  downloadFile(fileId: string): Promise<Readable>
  uploadFile(input: { name: string; mimeType: GoogleDriveFile['mimeType']; body: Readable }): Promise<GoogleDriveFile>
}

export function createGoogleDriveOps(config: GoogleDriveConfig): GoogleDriveOps {
  let clientPromise: ReturnType<typeof authedDrive> | null = null
  const client = () => (clientPromise ??= authedDrive(config))
  return {
    async listFiles(input) {
      const drive = await client()
      const response = await drive.files.list({
        q: buildGoogleDriveMediaQuery(input.query),
        pageSize: Math.max(1, Math.min(50, Math.trunc(input.pageSize ?? 20))),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
        orderBy: 'modifiedTime desc',
        spaces: 'drive',
        fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)',
      })
      return {
        files: (response.data.files ?? []).map(normalizeGoogleDriveFile).filter((file): file is GoogleDriveFile => file !== null),
        nextPageToken: response.data.nextPageToken ?? null,
      }
    },
    async getFile(fileId) {
      const drive = await client()
      const response = await drive.files.get({
        fileId,
        fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
      })
      return normalizeGoogleDriveFile(response.data)
    },
    async downloadFile(fileId) {
      const drive = await client()
      const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
      return response.data as unknown as Readable
    },
    async uploadFile(input) {
      const drive = await client()
      const response = await drive.files.create({
        requestBody: { name: input.name },
        media: { mimeType: input.mimeType, body: input.body },
        fields: 'id,name,mimeType,size,modifiedTime,webViewLink',
      })
      const file = normalizeGoogleDriveFile(response.data)
      if (!file) throw new Error('Google Drive returned invalid uploaded file metadata')
      return file
    },
  }
}
