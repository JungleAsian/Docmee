import type { AssignableRole, PanelRole } from './types'

export const ASSIGNABLE_ROLES: AssignableRole[] = ['secretary', 'doctor', 'clinic_admin']

export const ROLE_PERMISSIONS = [
  'inbox',
  'calendar',
  'patients',
  'templates',
  'voice_review',
  'analytics',
  'exports',
  'billing',
  'staff',
] as const

export const ROLE_MENU_ITEMS = [
  'inbox',
  'alerts',
  'calendar',
  'waitlist',
  'metrics',
  'analytics',
  'qos',
  'reports',
  'studio',
] as const

export type RolePermissionKey = (typeof ROLE_PERMISSIONS)[number]
export type RoleMenuItemKey = (typeof ROLE_MENU_ITEMS)[number]
export type RolePermissions = Record<RolePermissionKey, AssignableRole[]>
export type RoleMenuVisibility = Record<RoleMenuItemKey, AssignableRole[]>

export type RoleAccessSettings = Record<string, unknown> & {
  rolePermissions?: Partial<Record<RolePermissionKey, AssignableRole[]>>
  roleMenuVisibility?: Partial<Record<RoleMenuItemKey, AssignableRole[]>>
}

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  inbox: ['secretary', 'doctor', 'clinic_admin'],
  calendar: ['secretary', 'doctor', 'clinic_admin'],
  patients: ['secretary', 'doctor', 'clinic_admin'],
  templates: ['clinic_admin'],
  voice_review: ['secretary', 'doctor', 'clinic_admin'],
  analytics: ['clinic_admin'],
  exports: ['clinic_admin'],
  billing: ['clinic_admin'],
  staff: ['clinic_admin'],
}

export const DEFAULT_ROLE_MENU_VISIBILITY: RoleMenuVisibility = {
  inbox: ['secretary', 'doctor', 'clinic_admin'],
  alerts: ['secretary', 'doctor', 'clinic_admin'],
  calendar: ['secretary', 'doctor', 'clinic_admin'],
  waitlist: ['secretary', 'doctor', 'clinic_admin'],
  metrics: ['clinic_admin'],
  analytics: ['clinic_admin'],
  qos: ['clinic_admin'],
  reports: ['clinic_admin'],
  studio: ['clinic_admin'],
}

function readRoleList<T extends string>(
  saved: Partial<Record<T, AssignableRole[]>> | undefined,
  defaults: Record<T, AssignableRole[]>,
  keys: readonly T[],
): Record<T, AssignableRole[]> {
  return keys.reduce(
    (acc, key) => {
      const roles = saved?.[key]
      acc[key] = Array.isArray(roles)
        ? roles.filter((role): role is AssignableRole => ASSIGNABLE_ROLES.includes(role as AssignableRole))
        : defaults[key]
      return acc
    },
    {} as Record<T, AssignableRole[]>,
  )
}

export function readRolePermissions(settings: RoleAccessSettings): RolePermissions {
  return readRoleList(settings.rolePermissions, DEFAULT_ROLE_PERMISSIONS, ROLE_PERMISSIONS) as RolePermissions
}

export function readRoleMenuVisibility(settings: RoleAccessSettings): RoleMenuVisibility {
  return readRoleList(
    settings.roleMenuVisibility,
    DEFAULT_ROLE_MENU_VISIBILITY,
    ROLE_MENU_ITEMS,
  ) as RoleMenuVisibility
}

export function roleHasPermission(
  role: PanelRole | null | undefined,
  permission: RolePermissionKey,
  settings?: RoleAccessSettings,
): boolean {
  if (role === 'ia_studio_admin') return true
  if (!role || !ASSIGNABLE_ROLES.includes(role as AssignableRole)) return false
  return readRolePermissions(settings ?? {})[permission].includes(role as AssignableRole)
}

export function roleCanSeeMenuItem(
  role: PanelRole | null | undefined,
  item: RoleMenuItemKey,
  settings?: RoleAccessSettings,
): boolean {
  if (role === 'ia_studio_admin') return true
  if (!role || !ASSIGNABLE_ROLES.includes(role as AssignableRole)) return false
  return readRoleMenuVisibility(settings ?? {})[item].includes(role as AssignableRole)
}
