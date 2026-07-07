// Req 2 — Clinic-panel RBAC (single source of truth for role-specific views).
//
// The API gates every route with requireRole(...) (apps/api middleware/auth.ts).
// Until now the panel only *hid nav links* by role, so a secretary who navigated
// directly to /metrics rendered a broken page that fired a 403'd request. This
// module mirrors the server's requireRole matrix on the client so the UI enforces
// the SAME boundaries the API does — nav links, page guards and role-specific
// defaults all derive from one table.
//
// Keep ROLE_CAPABILITIES in lock-step with the API:
//   inbox / assistant  → requireRole('secretary','doctor','clinic_admin','ia_studio_admin')
//   metrics            → requireRole('clinic_admin','ia_studio_admin')   (routes/metrics.ts)
//   analytics          → requireRole('clinic_admin','ia_studio_admin')   (routes/analytics.ts)
//   qos                → requireRole('clinic_admin','ia_studio_admin')   (routes/qos.ts)
//   reports            → requireRole('clinic_admin','ia_studio_admin')   (routes/reports.ts)
//   studio             → ia_studio_admin only (clinic/kb/doctors/usage/… routes)
//
// Note on the role model: the panel has four implemented roles — secretary,
// doctor, clinic_admin and ia_studio_admin. The product brief's "assistant" is not
// a distinct DB role; the AI assistant is a panel *feature* (the 'assistant'
// capability), available to every frontline inbox role.
import type { PanelRole } from './types'

/** A clinic-panel surface a role may (or may not) reach. */
export type Capability =
  | 'inbox' // conversation list / view: read, reply, status, assign, notes
  | 'calendar' // booking calendar: read appointments, book/reschedule/cancel
  | 'assistant' // the AI assistant panel inside a conversation
  | 'metrics' // basic metrics dashboard
  | 'analytics' // advanced analytics dashboard (additionally feature-flagged)
  | 'qos' // quality-of-service monitor
  | 'reports' // automatic reports
  | 'studio' // Admin Studio admin console

const ROLE_CAPABILITIES: Record<PanelRole, readonly Capability[]> = {
  secretary: ['inbox', 'calendar', 'assistant'],
  doctor: ['inbox', 'calendar', 'assistant'],
  clinic_admin: ['inbox', 'calendar', 'assistant', 'metrics', 'analytics', 'qos', 'reports', 'studio'],
  // Platform super users can operate every clinic surface after selecting a clinic.
  ia_studio_admin: ['inbox', 'calendar', 'assistant', 'metrics', 'analytics', 'qos', 'reports', 'studio'],
}

const ALL_ROLES = Object.keys(ROLE_CAPABILITIES) as PanelRole[]

/** Whether a role may use a capability. Unknown / signed-out → false. */
export function can(role: PanelRole | undefined | null, capability: Capability): boolean {
  if (!role) return false
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false
}

/** The roles allowed to use a capability — pass straight to useAuthGuard(). */
export function rolesWith(capability: Capability): PanelRole[] {
  return ALL_ROLES.filter((role) => can(role, capability))
}

/** Every capability a role holds (used for tests / debugging). */
export function capabilitiesOf(role: PanelRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role] ?? []
}
