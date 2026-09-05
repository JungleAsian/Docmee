import { describe, expect, it } from 'vitest'
import { googleDriveAuthorization, googleOAuthAuthUrlPath, isTrustedGoogleOAuthUrl } from './googleOAuth'

describe('Google OAuth helpers', () => {
  it('builds authenticated clinic and doctor initiation paths', () => {
    expect(googleOAuthAuthUrlPath('clinic/one')).toBe('/clinic/clinic%2Fone/calendar/auth-url')
    expect(googleOAuthAuthUrlPath('clinic/one', 'doctor #1')).toBe(
      '/clinics/clinic%2Fone/doctors/doctor%20%231/calendar/auth-url',
    )
  })

  it('allows only the HTTPS Google Accounts authorization origin', () => {
    expect(isTrustedGoogleOAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?state=opaque')).toBe(true)
    expect(isTrustedGoogleOAuthUrl('http://accounts.google.com/o/oauth2/v2/auth')).toBe(false)
    expect(isTrustedGoogleOAuthUrl('https://accounts.google.com.evil.example/oauth')).toBe(false)
    expect(isTrustedGoogleOAuthUrl('https://evil.example/oauth')).toBe(false)
    expect(isTrustedGoogleOAuthUrl('not a url')).toBe(false)
  })

  it('requires both stored encrypted tokens before reporting Drive connected', () => {
    expect(googleDriveAuthorization({ scopes: ['https://www.googleapis.com/auth/drive.file'] })).toEqual({ connected: false, browseAuthorized: false, uploadAuthorized: true })
    expect(googleDriveAuthorization({ accessToken: 'enc:at', refreshToken: 'enc:rt', scopes: ['https://www.googleapis.com/auth/drive.readonly'] })).toEqual({ connected: true, browseAuthorized: true, uploadAuthorized: false })
  })
})
