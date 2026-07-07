import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type {
  ClinicUser,
  ClinicUserAuth,
  ClinicUserStatus,
  ClinicUserWithRole,
  NotificationPrefsRow,
  PanelLanguage,
  PanelRole,
  PermissionKey,
} from '../types/index.js'

/** Fields for creating a clinic user (Req 1 — Admin Studio user management). */
export interface CreateClinicUserInput {
  clinicId: string
  email: string
  fullName?: string | null
  status?: ClinicUserStatus
  /** Already-hashed password (use @docmee/shared hashPassword). Null = invited, no login yet. */
  passwordHash?: string | null
  panelLanguage?: PanelLanguage
  inactivityTimeoutMinutes?: number
}

/** Editable fields for an existing clinic user. Omitted fields are left unchanged. */
export interface UpdateClinicUserInput {
  email?: string
  fullName?: string | null
  status?: ClinicUserStatus
  passwordHash?: string | null
  panelLanguage?: PanelLanguage
  inactivityTimeoutMinutes?: number
}

export interface UsersRepository {
  findById(clinicId: string, id: string): Promise<ClinicUser | null>
  listByClinic(clinicId: string): Promise<ClinicUser[]>
  /** Clinic users with their resolved highest-privilege role (user-management list). */
  listWithRoles(clinicId: string): Promise<ClinicUserWithRole[]>
  /** A clinic user whose email matches (case-insensitive) — duplicate-email guard. Null if none. */
  findByEmail(clinicId: string, email: string): Promise<ClinicUser | null>
  /** Create a clinic user. The internal user_id is generated server-side. */
  create(input: CreateClinicUserInput): Promise<ClinicUser>
  /** Update a clinic user's editable fields. Null when the user is absent/foreign. */
  update(clinicId: string, id: string, input: UpdateClinicUserInput): Promise<ClinicUser | null>
  /** Delete a clinic user (assignments are SET NULL by FK). Returns false if absent/foreign. */
  delete(clinicId: string, id: string): Promise<boolean>
  /**
   * Set the user's single panel role: ensures a clinic-scoped role row for the
   * name exists, then replaces every user_roles link with the one role.
   */
  setRole(clinicId: string, clinicUserId: string, role: PanelRole): Promise<void>
  /** Email of the clinic's primary active user — the default alert recipient. */
  findPrimaryEmail(clinicId: string): Promise<string | null>
  /**
   * Email of an active clinic user holding the given role — the escalation
   * target (e.g. 'clinic_admin'). Null when no such user exists.
   */
  findEmailByRole(clinicId: string, role: PanelRole): Promise<string | null>
  /**
   * last_seen heartbeat of a clinic user by email (presence for alert routing).
   * Null when the email is unknown or the user has never been seen.
   */
  findLastSeenByEmail(clinicId: string, email: string): Promise<string | null>
  /** Bump last_seen to NOW() (heartbeat). Returns false if the user is unknown. */
  touchLastSeen(id: string): Promise<boolean>
  /**
   * Look up a clinic user by email for login. Returns the stored password hash
   * and the user's highest-privilege role name (resolved from user_roles/roles).
   * Email match is case-insensitive. Returns null if no such user exists.
   */
  findAuthByEmail(email: string): Promise<ClinicUserAuth | null>
  /** Persist the panel UI language preference. Returns false if the user is unknown. */
  setPanelLanguage(id: string, language: PanelLanguage): Promise<boolean>
  /** Raw notification preferences JSON for a user by id (clinic-scoped). Null if unknown. */
  getNotificationPrefs(clinicId: string, id: string): Promise<NotificationPrefsRow | null>
  /**
   * Raw notification preferences JSON for the alert recipient resolved by email
   * (clinic-scoped, active users) — the worker's email-routing gate. Empty object
   * when the email is unknown (i.e. permissive default in code).
   */
  findNotificationPrefsByEmail(clinicId: string, email: string): Promise<NotificationPrefsRow>
  /** Persist notification preferences for a user. Returns false if unknown. */
  setNotificationPrefs(id: string, prefs: NotificationPrefsRow): Promise<boolean>
}

// Highest privilege wins when a user holds several roles. Unknown role names
// fall back to the least-privileged 'secretary'.
const ROLE_RANK: Record<PanelRole, number> = {
  ia_studio_admin: 4,
  clinic_admin: 3,
  doctor: 2,
  secretary: 1,
}

function resolveRole(names: string[]): PanelRole {
  let best: PanelRole = 'secretary'
  for (const name of names) {
    if (name in ROLE_RANK && ROLE_RANK[name as PanelRole] > ROLE_RANK[best]) {
      best = name as PanelRole
    }
  }
  return best
}

export function createUsersRepository(sql: Sql): UsersRepository {
  return {
    async findById(clinicId, id) {
      const rows = await sql<ClinicUser[]>`
        SELECT * FROM clinic_users WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async listByClinic(clinicId) {
      return sql<ClinicUser[]>`
        SELECT * FROM clinic_users WHERE clinic_id = ${clinicId} ORDER BY created_at
      `
    },

    async listWithRoles(clinicId) {
      const rows = await sql<(ClinicUser & { roleNames: string[] })[]>`
        SELECT u.*,
               COALESCE(
                 ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL),
                 '{}'
               ) AS role_names
        FROM clinic_users u
        LEFT JOIN memberships m ON m.user_id = u.user_id
          AND m.status = 'active'
          AND (m.clinic_id = u.clinic_id OR m.clinic_id IS NULL)
        LEFT JOIN roles r ON r.id = m.role_id
        WHERE u.clinic_id = ${clinicId}
        GROUP BY u.id
        ORDER BY u.created_at
      `
      return rows.map(({ roleNames, ...user }) => ({
        ...(user as ClinicUser),
        role: resolveRole(roleNames ?? []),
      }))
    },

    async findByEmail(clinicId, email) {
      const rows = await sql<ClinicUser[]>`
        SELECT * FROM clinic_users
        WHERE clinic_id = ${clinicId} AND LOWER(email) = LOWER(${email})
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async create(input) {
      const rows = await sql<ClinicUser[]>`
        INSERT INTO clinic_users (
          clinic_id, user_id, email, full_name, status, password_hash, panel_language, inactivity_timeout_minutes
        )
        VALUES (
          ${input.clinicId},
          COALESCE((SELECT user_id FROM clinic_users WHERE LOWER(email) = LOWER(${input.email}) LIMIT 1), gen_random_uuid()),
          ${input.email},
          ${input.fullName ?? null},
          ${input.status ?? 'active'},
          ${input.passwordHash ?? null},
          ${input.panelLanguage ?? 'es'},
          ${input.inactivityTimeoutMinutes ?? 5}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, input) {
      const rows = await sql<ClinicUser[]>`
        UPDATE clinic_users SET
          email          = COALESCE(${input.email        ?? null}, email),
          full_name      = CASE WHEN ${input.fullName !== undefined} THEN ${input.fullName ?? null} ELSE full_name END,
          status         = COALESCE(${input.status       ?? null}, status),
          password_hash  = COALESCE(${input.passwordHash ?? null}, password_hash),
          panel_language = COALESCE(${input.panelLanguage ?? null}, panel_language),
          inactivity_timeout_minutes = COALESCE(${input.inactivityTimeoutMinutes ?? null}, inactivity_timeout_minutes)
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async delete(clinicId, id) {
      const rows = await sql<[{ id: string }]>`
        DELETE FROM clinic_users WHERE clinic_id = ${clinicId} AND id = ${id} RETURNING id
      `
      return rows.length > 0
    },

    async setRole(clinicId, clinicUserId, role) {
      // Prefer the system role catalogue. Keep the old user_roles link updated so
      // older screens and reports still resolve a single role while the membership
      // model rolls forward.
      const existing = await sql<[{ id: string }]>`
        SELECT id FROM roles WHERE clinic_id IS NULL AND name = ${role} AND is_system = TRUE LIMIT 1
      `
      let roleId = existing[0]?.id
      if (!roleId) {
        const created = await sql<[{ id: string }]>`
          INSERT INTO roles (clinic_id, name, description, is_system)
          VALUES (NULL, ${role}, ${`${role} (system)`}, TRUE)
          RETURNING id
        `
        roleId = created[0]!.id
      }
      const users = await sql<[{ accountUserId: string }]>`
        SELECT user_id AS account_user_id FROM clinic_users WHERE clinic_id = ${clinicId} AND id = ${clinicUserId} LIMIT 1
      `
      const accountUserId = users[0]?.accountUserId
      if (accountUserId) {
        await sql`
          DELETE FROM memberships
          WHERE user_id = ${accountUserId}
            AND (clinic_id = ${clinicId} OR clinic_id IS NULL)
        `
        await sql`
          INSERT INTO memberships (user_id, clinic_id, role_id, status)
          VALUES (${accountUserId}, ${role === 'ia_studio_admin' ? null : clinicId}, ${roleId}, 'active')
          ON CONFLICT DO NOTHING
        `
      }
      // Single panel role per user: clear existing links, then add the one role.
      await sql`DELETE FROM user_roles WHERE clinic_user_id = ${clinicUserId}`
      await sql`
        INSERT INTO user_roles (clinic_user_id, role_id)
        VALUES (${clinicUserId}, ${roleId})
        ON CONFLICT DO NOTHING
      `
    },

    async findPrimaryEmail(clinicId) {
      const rows = await sql<[{ email: string }]>`
        SELECT email FROM clinic_users
        WHERE clinic_id = ${clinicId} AND status = 'active'
        ORDER BY created_at
        LIMIT 1
      `
      return rows[0]?.email ?? null
    },

    async findEmailByRole(clinicId, role) {
      const rows = await sql<[{ email: string }]>`
        SELECT u.email
        FROM clinic_users u
        JOIN memberships m ON m.user_id = u.user_id AND m.status = 'active'
        JOIN roles r       ON r.id = m.role_id
        WHERE u.clinic_id = ${clinicId}
          AND u.status    = 'active'
          AND (m.clinic_id = ${clinicId} OR m.clinic_id IS NULL)
          AND r.name      = ${role}
        ORDER BY u.created_at
        LIMIT 1
      `
      return rows[0]?.email ?? null
    },

    async findLastSeenByEmail(clinicId, email) {
      const rows = await sql<[{ lastSeen: string | null }]>`
        SELECT last_seen FROM clinic_users
        WHERE clinic_id = ${clinicId} AND LOWER(email) = LOWER(${email}) AND status = 'active'
        ORDER BY created_at
        LIMIT 1
      `
      return rows[0]?.lastSeen ?? null
    },

    async touchLastSeen(id) {
      const rows = await sql<[{ id: string }]>`
        UPDATE clinic_users SET last_seen = NOW() WHERE id = ${id} RETURNING id
      `
      return rows.length > 0
    },

    async findAuthByEmail(email) {
      const rows = await sql<
        {
          id: string
          accountUserId: string
          clinicId: string
          email: string
          fullName: string | null
          status: ClinicUserAuth['status']
          passwordHash: string | null
          panelLanguage: PanelLanguage
          inactivityTimeoutMinutes: number
          roleNames: string[]
          permissions: PermissionKey[]
          accessibleClinicIds: string[]
          isGlobalSuperAdmin: boolean
        }[]
      >`
        WITH matched_user AS (
          SELECT *
          FROM clinic_users
          WHERE LOWER(email) = LOWER(${email})
          ORDER BY
            CASE WHEN status = 'active' THEN 0 ELSE 1 END,
            created_at
          LIMIT 1
        ),
        user_memberships AS (
          SELECT m.*
          FROM memberships m
          JOIN matched_user u ON u.user_id = m.user_id
          WHERE m.status = 'active'
        ),
        clinic_access AS (
          SELECT DISTINCT clinic_id
          FROM user_memberships
          WHERE clinic_id IS NOT NULL
        )
        SELECT u.id,
               u.user_id        AS account_user_id,
               u.clinic_id      AS clinic_id,
               u.email,
               u.full_name      AS full_name,
               u.status,
               u.password_hash  AS password_hash,
               u.panel_language AS panel_language,
               u.inactivity_timeout_minutes AS inactivity_timeout_minutes,
               COALESCE(
                 ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),
                 '{}'
               )                AS role_names
               , COALESCE(
                 ARRAY_AGG(DISTINCT p.key) FILTER (WHERE p.key IS NOT NULL),
                 '{}'
               )                AS permissions
               , COALESCE((SELECT ARRAY_AGG(clinic_id) FROM clinic_access), '{}') AS accessible_clinic_ids
               , COALESCE(BOOL_OR(r.name = 'ia_studio_admin' AND um.clinic_id IS NULL), FALSE) AS is_global_super_admin
        FROM matched_user u
        LEFT JOIN user_memberships um ON TRUE
        LEFT JOIN roles r ON r.id = um.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        GROUP BY u.id, u.user_id, u.clinic_id, u.email, u.full_name, u.status, u.password_hash, u.panel_language, u.inactivity_timeout_minutes
        LIMIT 1
      `
      const row = rows[0]
      if (!row) return null
      return {
        id: row.id,
        accountUserId: row.accountUserId,
        clinicId: row.clinicId,
        email: row.email,
        fullName: row.fullName,
        status: row.status,
        passwordHash: row.passwordHash,
        panelLanguage: row.panelLanguage,
        inactivityTimeoutMinutes: row.inactivityTimeoutMinutes,
        role: row.isGlobalSuperAdmin ? 'ia_studio_admin' : resolveRole(row.roleNames ?? []),
        permissions: row.permissions ?? [],
        accessibleClinicIds: row.accessibleClinicIds ?? [],
        isGlobalSuperAdmin: row.isGlobalSuperAdmin,
      }
    },

    async setPanelLanguage(id, language) {
      const rows = await sql<[{ id: string }]>`
        UPDATE clinic_users SET panel_language = ${language} WHERE id = ${id} RETURNING id
      `
      return rows.length > 0
    },

    async getNotificationPrefs(clinicId, id) {
      const rows = await sql<[{ prefs: NotificationPrefsRow }]>`
        SELECT notification_prefs AS prefs FROM clinic_users
        WHERE clinic_id = ${clinicId} AND id = ${id}
        LIMIT 1
      `
      return rows[0]?.prefs ?? null
    },

    async findNotificationPrefsByEmail(clinicId, email) {
      const rows = await sql<[{ prefs: NotificationPrefsRow }]>`
        SELECT notification_prefs AS prefs FROM clinic_users
        WHERE clinic_id = ${clinicId} AND LOWER(email) = LOWER(${email}) AND status = 'active'
        ORDER BY created_at
        LIMIT 1
      `
      return rows[0]?.prefs ?? {}
    },

    async setNotificationPrefs(id, prefs) {
      const rows = await sql<[{ id: string }]>`
        UPDATE clinic_users
        SET notification_prefs = ${sql.json(toJson(prefs))}
        WHERE id = ${id}
        RETURNING id
      `
      return rows.length > 0
    },
  }
}
