import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { ChannelAccount, ChannelAccountStatus, Channel } from '../types/index.js'

export interface CreateChannelAccountInput {
  clinicId: string
  channel: Channel
  accountId: string
  displayName?: string
  accessTokenEnc?: string
  webhookVerifyToken?: string
  status?: ChannelAccountStatus
  settings?: Record<string, unknown>
}

export interface ChannelAccountsRepository {
  /**
   * Resolve the channel account (and therefore the owning clinic) for an inbound
   * webhook by the provider account id (WhatsApp phone_number_id). Not clinic-scoped:
   * this is the lookup that *establishes* which clinic a message belongs to.
   */
  findByAccount(channel: Channel, accountId: string): Promise<ChannelAccount | null>
  listByClinic(clinicId: string): Promise<ChannelAccount[]>
  create(data: CreateChannelAccountInput): Promise<ChannelAccount>
  delete(clinicId: string, id: string): Promise<boolean>
}

export function createChannelAccountsRepository(sql: Sql): ChannelAccountsRepository {
  return {
    async findByAccount(channel, accountId) {
      const rows = await sql<ChannelAccount[]>`
        SELECT * FROM channel_accounts
        WHERE channel = ${channel} AND account_id = ${accountId} AND status = 'active'
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async listByClinic(clinicId) {
      return sql<ChannelAccount[]>`
        SELECT * FROM channel_accounts WHERE clinic_id = ${clinicId} ORDER BY created_at
      `
    },

    async create(data) {
      const rows = await sql<ChannelAccount[]>`
        INSERT INTO channel_accounts
          (clinic_id, channel, account_id, display_name, access_token_enc, webhook_verify_token, status, settings)
        VALUES (
          ${data.clinicId},
          ${data.channel},
          ${data.accountId},
          ${data.displayName ?? null},
          ${data.accessTokenEnc ?? null},
          ${data.webhookVerifyToken ?? null},
          ${data.status ?? 'active'},
          ${sql.json(toJson(data.settings ?? {}))}
        )
        ON CONFLICT (clinic_id, channel, account_id) DO UPDATE
          SET display_name         = EXCLUDED.display_name,
              access_token_enc     = EXCLUDED.access_token_enc,
              webhook_verify_token = EXCLUDED.webhook_verify_token,
              status               = EXCLUDED.status,
              settings             = EXCLUDED.settings
        RETURNING *
      `
      return rows[0]!
    },

    async delete(clinicId, id) {
      const rows = await sql<[{ id: string }]>`
        DELETE FROM channel_accounts
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING id
      `
      return rows.length > 0
    },
  }
}
