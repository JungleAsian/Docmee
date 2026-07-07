// License gate. THE ONE RULE: licensing never interrupts a live clinic.
// A running clinic is always allowed, even if the license is expired, invalid,
// or the license server is unreachable. Only NEW clinic activations are gated,
// and even those fail open when the server is unreachable.
export type LicenseState = 'valid' | 'expired' | 'invalid' | 'unreachable'

export async function checkLicense(clinicId: string): Promise<LicenseState> {
  const serverUrl = process.env['LICENSE_SERVER_URL']
  if (!serverUrl) return 'unreachable'

  try {
    const response = await fetch(`${serverUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clinicId }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return 'invalid'
    const { state } = (await response.json()) as { state: LicenseState }
    return state
  } catch {
    return 'unreachable' // server unreachable → running clinics keep working
  }
}

export async function enforceLicenseGate(
  clinicId: string,
  isNewActivation: boolean,
): Promise<void> {
  // Running clinics: ALWAYS allowed — never interrupt, never even phone home.
  if (!isNewActivation) return

  // New activations only: block if expired or invalid.
  const state = await checkLicense(clinicId)
  if (state === 'expired') {
    throw new Error('License expired. Renew to activate new clinics.')
  }
  if (state === 'invalid') {
    throw new Error('Invalid license key.')
  }
  // 'valid' and 'unreachable': allow (fail open on unreachable).
}
