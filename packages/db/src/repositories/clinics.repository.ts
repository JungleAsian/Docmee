import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { Clinic, ClinicPlan, ClinicStatus } from '../types/index.js'

export interface CreateClinicInput {
  name: string
  slug: string
  plan?: ClinicPlan
  status?: ClinicStatus
  settings?: Record<string, unknown>
  timezone?: string
  address?: string
  phone?: string
  clinicType?: string
}

export interface UpdateClinicInput {
  name?: string
  plan?: ClinicPlan
  status?: ClinicStatus
  settings?: Record<string, unknown>
  timezone?: string
  address?: string
  phone?: string
  clinicType?: string
  // P14 — Messenger connection. `messengerPageAccessToken` maps to the
  // *_encrypted column; pass it only when (re)setting the token.
  messengerPageId?: string
  messengerPageAccessToken?: string
  messengerWebhookVerifyToken?: string
  messengerEnabled?: boolean
  // P15 — Instagram connection. `instagramPageAccessToken` maps to the
  // *_encrypted column; pass it only when (re)setting the token.
  instagramAccountId?: string
  instagramPageAccessToken?: string
  instagramWebhookVerifyToken?: string
  instagramEnabled?: boolean
}

/**
 * Per-clinic operational counts for the Screen 6 clinic directory cards. One row
 * per clinic that has any users or conversations (clinics with neither are simply
 * absent — the caller defaults their counts to zero).
 */
export interface ClinicDirectoryStat {
  clinicId: string
  /** Panel users belonging to the clinic. */
  users: number
  /** Live conversations (anything not resolved/archived) — the "open chats" stat. */
  openChats: number
  /** Live conversations in human control (assigned or escalated) — the bot is paused for these. */
  handoff: number
  /** Live conversations carrying a patient-safety flag (emergency/urgent/upset) — must never be missed. */
  urgent: number
}

export interface ClinicsRepository {
  findById(id: string): Promise<Clinic | null>
  findBySlug(slug: string): Promise<Clinic | null>
  /** Resolve the clinic that owns an inbound Messenger event by its Page id (enabled only). */
  findByMessengerPageId(pageId: string): Promise<Clinic | null>
  /** Resolve the clinic that owns an inbound Instagram event by its account id (enabled only). */
  findByInstagramAccountId(accountId: string): Promise<Clinic | null>
  /**
   * All clinics, newest first. Defaults to including cancelled (soft-deleted)
   * ones — existing callers (workers iterating every clinic, the admin
   * Clinics Management view) rely on that. Pass `excludeCancelled: true` for
   * lookups that should never offer a deleted clinic (pickers/switchers).
   */
  list(options?: { excludeCancelled?: boolean }): Promise<Clinic[]>
  /** Count of clinics in the 'active' status — powers the Admin Studio overview (Gap #8). */
  countActive(): Promise<number>
  /**
   * Per-clinic operational counts for the Admin Studio clinic directory (Screen 6),
   * computed across every clinic in a few grouped queries (no N+1). A clinic with
   * neither users nor conversations is absent from the result.
   */
  directoryStats(): Promise<ClinicDirectoryStat[]>
  create(data: CreateClinicInput): Promise<Clinic>
  update(id: string, data: UpdateClinicInput): Promise<Clinic>
}

export function createClinicsRepository(sql: Sql): ClinicsRepository {
  return {
    async findById(id) {
      const rows = await sql<Clinic[]>`SELECT * FROM clinics WHERE id = ${id} LIMIT 1`
      return rows[0] ?? null
    },

    async findBySlug(slug) {
      const rows = await sql<Clinic[]>`SELECT * FROM clinics WHERE slug = ${slug} LIMIT 1`
      return rows[0] ?? null
    },

    async findByMessengerPageId(pageId) {
      const rows = await sql<Clinic[]>`
        SELECT * FROM clinics
        WHERE messenger_page_id = ${pageId} AND messenger_enabled = TRUE
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async findByInstagramAccountId(accountId) {
      const rows = await sql<Clinic[]>`
        SELECT * FROM clinics
        WHERE instagram_account_id = ${accountId} AND instagram_enabled = TRUE
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async list(options) {
      if (options?.excludeCancelled) {
        return sql<Clinic[]>`
          SELECT * FROM clinics WHERE status != 'cancelled' ORDER BY created_at DESC
        `
      }
      return sql<Clinic[]>`SELECT * FROM clinics ORDER BY created_at DESC`
    },

    async countActive() {
      const rows = await sql<[{ count: string }]>`
        SELECT COUNT(*) FROM clinics WHERE status = 'active'
      `
      return parseInt(rows[0]?.count ?? '0', 10)
    },

    async directoryStats() {
      type Row = { clinicId: string; count: string }
      const [users, openChats, handoff, urgent] = await Promise.all([
        sql<Row[]>`
          SELECT clinic_id AS "clinicId", COUNT(*) AS count
          FROM clinic_users
          GROUP BY clinic_id
        `,
        sql<Row[]>`
          SELECT clinic_id AS "clinicId", COUNT(*) AS count
          FROM conversations
          WHERE status NOT IN ('resolved', 'archived')
          GROUP BY clinic_id
        `,
        sql<Row[]>`
          SELECT clinic_id AS "clinicId", COUNT(*) AS count
          FROM conversations
          WHERE status IN ('assigned', 'handoff')
          GROUP BY clinic_id
        `,
        // Patient-safety flags (Req 20) — emergency/medical_safety/urgent/upset — on a
        // still-live thread. COUNT(DISTINCT) so a thread with two safety tags counts once.
        sql<Row[]>`
          SELECT c.clinic_id AS "clinicId", COUNT(DISTINCT c.id) AS count
          FROM conversations c
          JOIN conversation_tag_links l ON l.conversation_id = c.id
          JOIN conversation_tags t ON t.id = l.tag_id
          WHERE t.name IN ('emergency', 'medical_safety', 'urgent', 'patient_upset')
            AND c.status NOT IN ('resolved', 'archived')
          GROUP BY c.clinic_id
        `,
      ])

      const map = new Map<string, ClinicDirectoryStat>()
      const ensure = (clinicId: string): ClinicDirectoryStat => {
        let stat = map.get(clinicId)
        if (!stat) {
          stat = { clinicId, users: 0, openChats: 0, handoff: 0, urgent: 0 }
          map.set(clinicId, stat)
        }
        return stat
      }
      for (const r of users) ensure(r.clinicId).users = parseInt(r.count, 10)
      for (const r of openChats) ensure(r.clinicId).openChats = parseInt(r.count, 10)
      for (const r of handoff) ensure(r.clinicId).handoff = parseInt(r.count, 10)
      for (const r of urgent) ensure(r.clinicId).urgent = parseInt(r.count, 10)
      return [...map.values()]
    },

    async create(data) {
      const rows = await sql<Clinic[]>`
        INSERT INTO clinics (name, slug, plan, status, settings, timezone, address, phone, clinic_type)
        VALUES (
          ${data.name},
          ${data.slug},
          ${data.plan ?? 'starter'},
          ${data.status ?? 'active'},
          ${sql.json(toJson(data.settings ?? {}))},
          ${data.timezone ?? 'America/Guatemala'},
          ${data.address ?? null},
          ${data.phone ?? null},
          ${data.clinicType ?? null}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(id, data) {
      const rows = await sql<Clinic[]>`
        UPDATE clinics SET
          name        = COALESCE(${data.name       ?? null}, name),
          plan        = COALESCE(${data.plan       ?? null}, plan),
          status      = COALESCE(${data.status     ?? null}, status),
          timezone    = COALESCE(${data.timezone   ?? null}, timezone),
          address     = COALESCE(${data.address    ?? null}, address),
          phone       = COALESCE(${data.phone      ?? null}, phone),
          clinic_type = COALESCE(${data.clinicType ?? null}, clinic_type),
          messenger_page_id                     = COALESCE(${data.messengerPageId          ?? null}, messenger_page_id),
          messenger_page_access_token_encrypted = COALESCE(${data.messengerPageAccessToken ?? null}, messenger_page_access_token_encrypted),
          messenger_webhook_verify_token        = COALESCE(${data.messengerWebhookVerifyToken ?? null}, messenger_webhook_verify_token),
          messenger_enabled                     = COALESCE(${data.messengerEnabled         ?? null}, messenger_enabled),
          instagram_account_id                   = COALESCE(${data.instagramAccountId        ?? null}, instagram_account_id),
          instagram_page_access_token_encrypted  = COALESCE(${data.instagramPageAccessToken  ?? null}, instagram_page_access_token_encrypted),
          instagram_webhook_verify_token         = COALESCE(${data.instagramWebhookVerifyToken ?? null}, instagram_webhook_verify_token),
          instagram_enabled                      = COALESCE(${data.instagramEnabled          ?? null}, instagram_enabled),
          settings = CASE WHEN ${data.settings !== undefined} THEN ${sql.json(toJson(data.settings ?? {}))} ELSE settings END
        WHERE id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Clinic not found: ${id}`)
      return rows[0]
    },
  }
}
