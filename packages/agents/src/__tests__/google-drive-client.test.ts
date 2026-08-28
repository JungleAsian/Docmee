import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_READONLY_SCOPE,
  buildGoogleDriveMediaQuery,
  normalizeGoogleDriveFile,
} from '../drive/google-drive-client.js'

describe('Google Drive media client', () => {
  it('uses the least-privilege read-only scope needed to browse existing files', () => {
    expect(GOOGLE_DRIVE_READONLY_SCOPE).toBe('https://www.googleapis.com/auth/drive.readonly')
  })

  it('filters out deleted and unsupported files and safely escapes search text', () => {
    const query = buildGoogleDriveMediaQuery("patient's \\ scan")
    expect(query).toContain('trashed = false')
    expect(query).toContain("mimeType = 'application/pdf'")
    expect(query).toContain("mimeType = 'image/jpeg'")
    expect(query).toContain("mimeType = 'image/png'")
    expect(query).toContain("mimeType = 'image/webp'")
    expect(query).toContain("name contains 'patient\\'s \\\\ scan'")
  })

  it('rejects incomplete or oversized provider metadata at the client boundary', () => {
    expect(normalizeGoogleDriveFile({ id: 'f1', name: 'scan.pdf', mimeType: 'application/pdf', size: '400' })).toMatchObject({
      id: 'f1',
      name: 'scan.pdf',
      byteSize: 400,
    })
    expect(normalizeGoogleDriveFile({ id: '', name: 'scan.pdf', mimeType: 'application/pdf', size: '400' })).toBeNull()
    expect(normalizeGoogleDriveFile({ id: 'f2', name: 'notes.txt', mimeType: 'text/plain', size: '400' })).toBeNull()
  })
})
