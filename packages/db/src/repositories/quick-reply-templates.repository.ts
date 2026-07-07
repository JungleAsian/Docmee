import type { Sql } from '../client.js'
import type { QuickReplyTemplate } from '../types/index.js'

export interface CreateQuickReplyTemplateInput {
  clinicId: string
  title: string
  content: string
  category?: string
}

export interface UpdateQuickReplyTemplateInput {
  title: string
  content: string
  category?: string
}

export interface QuickReplyTemplatesRepository {
  listByClinic(clinicId: string): Promise<QuickReplyTemplate[]>
  create(data: CreateQuickReplyTemplateInput): Promise<QuickReplyTemplate>
  update(
    clinicId: string,
    id: string,
    data: UpdateQuickReplyTemplateInput,
  ): Promise<QuickReplyTemplate | null>
  delete(clinicId: string, id: string): Promise<boolean>
}

export function createQuickReplyTemplatesRepository(sql: Sql): QuickReplyTemplatesRepository {
  return {
    async listByClinic(clinicId) {
      return sql<QuickReplyTemplate[]>`
        SELECT * FROM quick_reply_templates
        WHERE clinic_id = ${clinicId}
        ORDER BY created_at DESC
      `
    },

    async create(data) {
      const rows = await sql<QuickReplyTemplate[]>`
        INSERT INTO quick_reply_templates (clinic_id, title, content, category)
        VALUES (${data.clinicId}, ${data.title}, ${data.content}, ${data.category ?? 'general'})
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<QuickReplyTemplate[]>`
        UPDATE quick_reply_templates
        SET title = ${data.title}, content = ${data.content}, category = ${data.category ?? 'general'}, updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async delete(clinicId, id) {
      const rows = await sql<{ id: string }[]>`
        DELETE FROM quick_reply_templates
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING id
      `
      return rows.length > 0
    },
  }
}
