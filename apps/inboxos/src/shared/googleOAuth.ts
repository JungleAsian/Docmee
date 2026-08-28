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
