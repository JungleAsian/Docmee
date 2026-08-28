import { describe, it, expect } from 'vitest'
import {
  GOOGLE_DRIVE_MEDIA_TAB,
  MEDIA_REPOSITORY_TABS,
  googleDriveImportPath,
  googleDrivePreviewPath,
  isDriveImagePreviewEligible,
  isImageMessage,
  messageMediaPath,
} from './media'

describe('media helpers (Req 3)', () => {
  it('isImageMessage is true only for image content', () => {
    expect(isImageMessage({ contentType: 'image' })).toBe(true)
    expect(isImageMessage({ contentType: 'text' })).toBe(false)
    expect(isImageMessage({ contentType: 'audio' })).toBe(false)
    expect(isImageMessage({ contentType: 'interactive' })).toBe(false)
  })

  it('messageMediaPath builds the authenticated proxy path', () => {
    expect(messageMediaPath('conv-1', 'msg-9')).toBe('/conversations/conv-1/messages/msg-9/media')
  })

  it('defines the approved Docmee Files and Google Drive repository tabs', () => {
    expect(MEDIA_REPOSITORY_TABS).toEqual([
      { id: 'docmee', label: 'Docmee Files' },
      { id: GOOGLE_DRIVE_MEDIA_TAB, label: 'Google Drive' },
    ])
  })

  it('encodes clinic and provider file identifiers in the Drive import path', () => {
    expect(googleDriveImportPath('clinic/one', 'file #1')).toBe('/clinics/clinic%2Fone/media/google-drive/file%20%231/import')
  })

  it('uses authenticated previews only for bounded Drive images', () => {
    expect(googleDrivePreviewPath('clinic/one', 'file #1')).toBe('/clinics/clinic%2Fone/media/google-drive/file%20%231/preview')
    expect(isDriveImagePreviewEligible({ mimeType: 'image/png', byteSize: 10 * 1024 * 1024 })).toBe(true)
    expect(isDriveImagePreviewEligible({ mimeType: 'image/png', byteSize: 10 * 1024 * 1024 + 1 })).toBe(false)
    expect(isDriveImagePreviewEligible({ mimeType: 'application/pdf', byteSize: 20 })).toBe(false)
  })
})
