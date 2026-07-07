import type { Sql } from '../client.js'
import type { PanelRole, PermissionKey } from '../types/index.js'

export interface EffectiveAccess {
  accountUserId: string
  clinicId: string | null
  role: PanelRole
  permissions: PermissionKey[]
  accessibleClinicIds: string[]
  isGlobalSuperAdmin: boolean
}

export interface AccessRepository {
  getEffectiveAccess(accountUserId: string, clinicId?: string | null): Promise<EffectiveAccess>
  listUserMemberships(accountUserId: string): Promise<
    {
      id: string
      clinicId: string | null
      roleId: string
      roleName: PanelRole
      status: 'active' | 'suspended'
    }[]
  >
}

const ROLE_RANK: Record<PanelRole, number> = {
  ia_studio_admin: 4,
  clinic_admin: 3,
  doctor: 2,
  secretary: 1,
}

function resolveRole(names: string[]): PanelRole {
  let best: PanelRole = 'secretary'
  for (const name of names) {
    if (name in ROLE_RANK && ROLE_RANK[name as PanelRole] > ROLE_RANK[best]) best = name as PanelRole
  }
  return best
}

export function createAccessRepository(sql: Sql): AccessRepository {
  return {
    async getEffectiveAccess(accountUserId, clinicId = null) {
      const rows = await sql<
        {
          roleNames: string[]
          permissions: PermissionKey[]
          accessibleClinicIds: string[]
          isGlobalSuperAdmin: boolean
        }[]
      >`
        WITH active_memberships AS (
          SELECT m.*
          FROM memberships m
          JOIN roles r ON r.id = m.role_id
          WHERE m.user_id = ${accountUserId}
            AND m.status = 'active'
            AND (
              m.clinic_id IS NULL
              OR ${clinicId}::uuid IS NULL
              OR m.clinic_id = ${clinicId}::uuid
            )
        ),
        clinic_access AS (
          SELECT DISTINCT m.clinic_id
          FROM memberships m
          WHERE m.user_id = ${accountUserId}
            AND m.status = 'active'
            AND m.clinic_id IS NOT NULL
        )
        SELECT
          COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS role_names,
          COALESCE(ARRAY_AGG(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL), '{}') AS permissions,
          COALESCE((SELECT ARRAY_AGG(clinic_id) FROM clinic_access), '{}') AS accessible_clinic_ids,
          COALESCE(BOOL_OR(r.name = 'ia_studio_admin' AND am.clinic_id IS NULL), FALSE) AS is_global_super_admin
        FROM active_memberships am
        JOIN roles r ON r.id = am.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
      `
      const row = rows[0]
      const roleNames = row?.roleNames ?? []
      const isGlobalSuperAdmin = Boolean(row?.isGlobalSuperAdmin)
      return {
        accountUserId,
        clinicId,
        role: isGlobalSuperAdmin ? 'ia_studio_admin' : resolveRole(roleNames),
        permissions: row?.permissions ?? [],
        accessibleClinicIds: row?.accessibleClinicIds ?? [],
        isGlobalSuperAdmin,
      }
    },

    async listUserMemberships(accountUserId) {
      return sql`
        SELECT m.id, m.clinic_id, m.role_id, r.name AS role_name, m.status
        FROM memberships m
        JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = ${accountUserId}
        ORDER BY m.clinic_id NULLS FIRST, r.name
      `
    },
  }
}
