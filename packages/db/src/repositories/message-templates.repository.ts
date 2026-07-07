import type { Sql } from '../client.js'
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateStatus,
} from '../types/index.js'

export interface CreateMessageTemplateInput {
  clinicId: string
  name: string
  category: MessageTemplateCategory
  language?: string
  body: string
  status?: MessageTemplateStatus
}

export interface MessageTemplatesRepository {
  listByClinic(clinicId: string): Promise<MessageTemplate[]>
  /** Every APPROVED template for a clinic, newest-updated first — the catalogue a
   *  secretary can send by hand from the inbox to re-engage a patient outside the
   *  24h window (Rev1 #3). */
  listApproved(clinicId: string): Promise<MessageTemplate[]>
  /**
   * The most recently updated APPROVED template in a category, or null. Lets the
   * follow-up worker send a proactive message outside the 24h customer-care window
   * using clinic-approved copy (Rev1 #14 / Meta compliance Rev1 #19).
   */
  findApprovedByCategory(clinicId: string, category: MessageTemplateCategory): Promise<MessageTemplate | null>
  /** A single APPROVED template by id, or null — the guard for a manual send: a
   *  pending/rejected/unknown template can never be sent (Rev1 #3). */
  findApprovedById(clinicId: string, id: string): Promise<MessageTemplate | null>
  create(data: CreateMessageTemplateInput): Promise<MessageTemplate>
  setStatus(clinicId: string, id: string, status: MessageTemplateStatus): Promise<MessageTemplate | null>
  setMetaState(
    clinicId: string,
    id: string,
    input: { metaTemplateId?: string | null; metaStatus?: string | null; metaLastError?: string | null; status?: MessageTemplateStatus },
  ): Promise<MessageTemplate | null>
}

export function createMessageTemplatesRepository(sql: Sql): MessageTemplatesRepository {
  return {
    async listByClinic(clinicId) {
      return sql<MessageTemplate[]>`
        SELECT * FROM message_templates
        WHERE clinic_id = ${clinicId}
        ORDER BY created_at DESC
      `
    },

    async listApproved(clinicId) {
      return sql<MessageTemplate[]>`
        SELECT * FROM message_templates
        WHERE clinic_id = ${clinicId} AND status = 'approved'
        ORDER BY updated_at DESC
      `
    },

    async findApprovedByCategory(clinicId, category) {
      const rows = await sql<MessageTemplate[]>`
        SELECT * FROM message_templates
        WHERE clinic_id = ${clinicId} AND category = ${category} AND status = 'approved'
        ORDER BY updated_at DESC
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async findApprovedById(clinicId, id) {
      const rows = await sql<MessageTemplate[]>`
        SELECT * FROM message_templates
        WHERE clinic_id = ${clinicId} AND id = ${id} AND status = 'approved'
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async create(data) {
      // A clinic submits one template per name; resubmitting resets it to pending.
      const rows = await sql<MessageTemplate[]>`
        INSERT INTO message_templates (clinic_id, name, category, language, body, status)
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${data.category},
          ${data.language ?? 'es'},
          ${data.body},
          ${data.status ?? 'pending'}
        )
        ON CONFLICT (clinic_id, name) DO UPDATE
          SET category   = EXCLUDED.category,
              language   = EXCLUDED.language,
              body       = EXCLUDED.body,
              status     = EXCLUDED.status,
              updated_at = NOW()
        RETURNING *
      `
      return rows[0]!
    },

    async setStatus(clinicId, id, status) {
      const rows = await sql<MessageTemplate[]>`
        UPDATE message_templates
        SET status = ${status}, updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async setMetaState(clinicId, id, input) {
      const rows = await sql<MessageTemplate[]>`
        UPDATE message_templates
        SET meta_template_id = COALESCE(${input.metaTemplateId ?? null}, meta_template_id),
            meta_status = COALESCE(${input.metaStatus ?? null}, meta_status),
            meta_last_error = ${input.metaLastError ?? null},
            meta_last_synced_at = NOW(),
            status = COALESCE(${input.status ?? null}, status),
            updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },
  }
}
