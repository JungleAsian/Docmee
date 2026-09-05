export function googleOAuthAuthUrlPath(clinicId: string, doctorId?: string): string {
  const clinic = encodeURIComponent(clinicId)
  if (doctorId) {
    return `/clinics/${clinic}/doctors/${encodeURIComponent(doctorId)}/calendar/auth-url`
  }
  return `/clinic/${clinic}/calendar/auth-url`
}

export function isTrustedGoogleOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com'
  } catch {
    return false
  }
}


export function googleDriveAuthorization(connection: Record<string, unknown> | null | undefined) {
  const scopes = Array.isArray(connection?.scopes)
    ? connection.scopes.filter((scope): scope is string => typeof scope === 'string')
    : []
  const connected = typeof connection?.accessToken === 'string' && typeof connection?.refreshToken === 'string'
  return {
    connected,
    browseAuthorized: scopes.includes('https://www.googleapis.com/auth/drive.readonly') || scopes.includes('https://www.googleapis.com/auth/drive'),
    uploadAuthorized: scopes.includes('https://www.googleapis.com/auth/drive.file') || scopes.includes('https://www.googleapis.com/auth/drive'),
  }
}
