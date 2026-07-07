// Screen 6 (Clinics & users) — pure derivations for the Admin Studio clinic directory
// cards and the per-clinic users table. Kept side-effect free (no Date.now, no React)
// so the card/status/mode logic is unit-testable in isolation.
import type { Clinic, ClinicStatus, PanelRole } from './types'

/** Per-clinic operational counts (mirrors the API GET /clinics/overview rows). */
export interface ClinicDirectoryStat {
  clinicId: string
  users: number
  openChats: number
  handoff: number
  urgent: number
}

/** Visual tone for the clinic status tag. */
export type ClinicStatusTone = 'active' | 'paused' | 'cancelled'

/**
 * Map the stored clinic status to a card tone. 'active' → green (bot answering),
 * 'suspended' → paused/gray (humans only), 'cancelled' → red.
 */
export function clinicStatusTone(status: ClinicStatus): ClinicStatusTone {
  if (status === 'active') return 'active'
  if (status === 'cancelled') return 'cancelled'
  return 'paused'
}

export interface ClinicCardModel {
  users: number
  openChats: number
  handoff: number
  urgent: number
  tone: ClinicStatusTone
  /** The AI is auto-answering patients (clinic active). When false the bot is paused → humans only. */
  botActive: boolean
  /** This is the clinic the operator is currently acting inside (the switched/active clinic). */
  isCurrent: boolean
  /** This is the operator's own home clinic (the tenant they belong to). */
  isHome: boolean
}

/**
 * Build the directory-card view-model for one clinic, folding in its operational
 * counts (defaulting to zero when the clinic has no activity yet) and the
 * active/home flags that drive the "Active now" / "Your home clinic" treatment.
 */
export function clinicCardModel(
  clinic: Clinic,
  stat: ClinicDirectoryStat | undefined,
  ctx: { activeClinicId: string; homeClinicId: string },
): ClinicCardModel {
  const tone = clinicStatusTone(clinic.status)
  return {
    users: stat?.users ?? 0,
    openChats: stat?.openChats ?? 0,
    handoff: stat?.handoff ?? 0,
    urgent: stat?.urgent ?? 0,
    tone,
    botActive: tone === 'active',
    isCurrent: clinic.id === ctx.activeClinicId,
    isHome: clinic.id === ctx.homeClinicId,
  }
}

/**
 * Order the directory the way the mockup reads it: the clinic the operator is
 * acting in first, then their home clinic, then the rest alphabetically. Pure —
 * returns a new array.
 */
export function sortClinicsForDirectory(
  clinics: readonly Clinic[],
  ctx: { activeClinicId: string; homeClinicId: string },
): Clinic[] {
  const rank = (c: Clinic): number => {
    if (c.id === ctx.activeClinicId) return 0
    if (c.id === ctx.homeClinicId) return 1
    return 2
  }
  return [...clinics].sort((a, b) => {
    const r = rank(a) - rank(b)
    return r !== 0 ? r : a.name.localeCompare(b.name)
  })
}

/**
 * The i18n key suffix describing a role's default inbox view (Req 2 — role-specific
 * defaults), shown in the users table so an admin can see at a glance what each
 * person lands on. Mirrors the shared RBAC defaults.
 */
export function defaultViewKey(role: PanelRole): 'allClinics' | 'allChats' | 'assignedToMe' | 'unassigned' {
  switch (role) {
    case 'ia_studio_admin':
      return 'allClinics'
    case 'clinic_admin':
      return 'allChats'
    case 'doctor':
      return 'assignedToMe'
    case 'secretary':
    default:
      return 'unassigned'
  }
}
