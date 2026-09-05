// Inbound media helpers (Req 3). A patient's WhatsApp image is rendered in-thread
// by fetching it from the authenticated proxy below; these pure helpers are the
// single source of truth for "is this an image message?" and the proxy path, so
// the component and its tests agree.

/** True when a message should render as an inline image rather than text. */
export function isImageMessage(message: { contentType: string }): boolean {
  return message.contentType === 'image'
}

/** Authenticated proxy path for a message's media (fetched as a blob, not via <img src>). */
export function messageMediaPath(conversationId: string, messageId: string): string {
  return `/conversations/${conversationId}/messages/${messageId}/media`
}

export const GOOGLE_DRIVE_MEDIA_TAB = 'google_drive' as const
export type MediaRepositoryTab = 'docmee' | typeof GOOGLE_DRIVE_MEDIA_TAB

export const MEDIA_REPOSITORY_TABS: ReadonlyArray<{ id: MediaRepositoryTab; label: string }> = [
  { id: 'docmee', label: 'Docmee Files' },
  { id: GOOGLE_DRIVE_MEDIA_TAB, label: 'Google Drive' },
]

export function googleDriveImportPath(clinicId: string, fileId: string): string {
  return `/clinics/${encodeURIComponent(clinicId)}/media/google-drive/${encodeURIComponent(fileId)}/import`
}

export function googleDrivePreviewPath(clinicId: string, fileId: string): string {
  return `/clinics/${encodeURIComponent(clinicId)}/media/google-drive/${encodeURIComponent(fileId)}/preview`
}

export function googleDriveUploadPath(clinicId: string): string {
  return `/clinics/${encodeURIComponent(clinicId)}/media/google-drive/upload`
}

export function isDriveImagePreviewEligible(file: { mimeType: string; byteSize: number }): boolean {
  return file.mimeType.startsWith('image/') && file.byteSize > 0 && file.byteSize <= 10 * 1024 * 1024
}

export function runForCurrentClinic<T>(capturedClinicId: string, getCurrentClinicId: () => string | null | undefined, effect: () => T): T | undefined {
  if (getCurrentClinicId() !== capturedClinicId) return undefined
  return effect()
}
