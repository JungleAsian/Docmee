// Req 32 — Quality of Service monitoring.
//
// Aggregations that surface service-quality problems the basic metrics dashboard
// (metrics.repository.ts) does not: upset patients, abandoned conversations,
// secretary vs bot response times, unclosed (open-too-long) conversations and
// re-engageable follow-up opportunities — plus an actionable "needs attention"
// list. Pure aggregate reads on existing tables (no migration).
//
// Signals come from existing data: the bot worker tags an upset patient's
// conversation 'patient_upset'; message roles are 'user' (patient),
// 'assistant' (bot) and 'agent' (human secretary); the 7-state conversation
// lifecycle treats only 'resolved'/'archived' as closed.
import type { Sql } from '../client.js'

const num = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** One conversation flagged as needing service attention now. */
export interface QosAttentionItem {
  conversationId: string
  patientName: string
  status: string
  channel: string
  /** Why it surfaced: an upset patient, a patient who went silent, or left open too long. */
  reason: 'upset' | 'abandoned' | 'unclosed'
  /** Who is currently handling the thread: a human secretary owns it, or the bot is auto-answering. */
  mode: 'bot' | 'human'
  lastMessageAt: string | null
}

/** Quality-of-service snapshot for one clinic (powers the Req 32 QoS dashboard). */
export interface QosDashboard {
  /** Conversations tagged 'patient_upset' in the last 30 days. */
  upsetPatients: number
  /** Of those, still in a non-terminal status (actionable now). */
  upsetUnresolved: number
  /**
   * Non-terminal conversations where the patient went silent: the last message was
   * the clinic's (bot/secretary) and nothing has happened for `staleHours`+.
   */
  abandonedConversations: number
  /** Mean seconds from a patient message to the next bot reply (last 30 days). */
  avgBotResponseSeconds: number
  /** Mean seconds from a patient message to the next human (secretary) reply (last 30 days). */
  avgSecretaryResponseSeconds: number
  /** All conversations still open (status not resolved/archived) — the open backlog. */
  unclosedConversations: number
  /** Of those, inactive for `staleHours`+ — the closure problem. */
  unclosedAged: number
  /**
   * Re-engageable leads: last-30-day conversations with a patient message, no
   * confirmed/completed appointment, and now closed or gone stale.
   */
  followUpOpportunities: number
  /** Scheduled follow-ups still pending delivery. */
  pendingFollowUps: number
  /** The inactivity threshold (hours) used for the aged/abandoned figures (echoed for the UI). */
  staleHours: number
  /** Up to 50 conversations needing attention now, oldest activity first. */
  attention: QosAttentionItem[]
}

export interface QosRepository {
  dashboard(clinicId: string, staleHours?: number): Promise<QosDashboard>
}

export function createQosRepository(sql: Sql): QosRepository {
  return {
    async dashboard(clinicId, staleHours = 24) {
      const hours = Math.max(1, Math.floor(staleHours))

      const [upset, response, closure, abandoned, followUp, pending, attention] = await Promise.all([
        sql<[{ total: string; unresolved: string }]>`
          -- qos:upset
          SELECT
            COUNT(DISTINCT c.id)                                                              AS total,
            COUNT(DISTINCT c.id) FILTER (WHERE c.status NOT IN ('resolved', 'archived'))       AS unresolved
          FROM conversations c
          JOIN conversation_tag_links tl ON tl.conversation_id = c.id
          JOIN conversation_tags t       ON t.id = tl.tag_id AND t.clinic_id = c.clinic_id
          WHERE c.clinic_id = ${clinicId}
            AND t.name = 'patient_upset'
            AND c.created_at >= NOW() - INTERVAL '30 days'
        `,
        sql<[{ botSeconds: string | null; secretarySeconds: string | null }]>`
          -- qos:response
          WITH ordered AS (
            SELECT
              role,
              created_at,
              LEAD(created_at) OVER (PARTITION BY conversation_id ORDER BY created_at) AS next_at,
              LEAD(role)       OVER (PARTITION BY conversation_id ORDER BY created_at) AS next_role
            FROM conversation_messages
            WHERE clinic_id = ${clinicId} AND created_at >= NOW() - INTERVAL '30 days'
          )
          SELECT
            COALESCE(AVG(EXTRACT(EPOCH FROM (next_at - created_at)))
              FILTER (WHERE next_role = 'assistant'), 0) AS bot_seconds,
            COALESCE(AVG(EXTRACT(EPOCH FROM (next_at - created_at)))
              FILTER (WHERE next_role = 'agent'), 0)     AS secretary_seconds
          FROM ordered
          WHERE role = 'user'
            AND next_at IS NOT NULL
            AND next_at - created_at < INTERVAL '1 day'
        `,
        sql<[{ unclosed: string; unclosedAged: string }]>`
          -- qos:closure
          SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'archived')) AS unclosed,
            COUNT(*) FILTER (
              WHERE status NOT IN ('resolved', 'archived')
                AND COALESCE(last_message_at, created_at) < NOW() - (${hours} || ' hours')::interval
            ) AS unclosed_aged
          FROM conversations
          WHERE clinic_id = ${clinicId}
        `,
        sql<[{ count: string }]>`
          -- qos:abandoned
          WITH last_msg AS (
            SELECT DISTINCT ON (m.conversation_id)
              m.conversation_id, m.role AS last_role, m.created_at AS last_at
            FROM conversation_messages m
            WHERE m.clinic_id = ${clinicId}
            ORDER BY m.conversation_id, m.created_at DESC
          )
          SELECT COUNT(*) AS count
          FROM conversations c
          JOIN last_msg lm ON lm.conversation_id = c.id
          WHERE c.clinic_id = ${clinicId}
            AND c.status NOT IN ('resolved', 'archived')
            AND lm.last_role IN ('assistant', 'agent')
            AND lm.last_at < NOW() - (${hours} || ' hours')::interval
            AND EXISTS (
              SELECT 1 FROM conversation_messages u
              WHERE u.conversation_id = c.id AND u.role = 'user'
            )
        `,
        sql<[{ count: string }]>`
          -- qos:followup
          SELECT COUNT(*) AS count
          FROM conversations c
          WHERE c.clinic_id = ${clinicId}
            AND c.created_at >= NOW() - INTERVAL '30 days'
            AND EXISTS (
              SELECT 1 FROM conversation_messages u
              WHERE u.conversation_id = c.id AND u.role = 'user'
            )
            AND NOT EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.conversation_id = c.id AND a.status IN ('confirmed', 'completed')
            )
            AND (
              c.status IN ('resolved', 'archived')
              OR COALESCE(c.last_message_at, c.created_at) < NOW() - (${hours} || ' hours')::interval
            )
        `,
        sql<[{ count: string }]>`
          -- qos:pending
          SELECT COUNT(*) AS count FROM follow_ups
          WHERE clinic_id = ${clinicId} AND status = 'pending'
        `,
        sql<
          {
            conversationId: string
            patientName: string | null
            status: string
            channel: string
            assignedTo: string | null
            lastMessageAt: string | null
            upset: boolean
            lastRole: string | null
          }[]
        >`
          -- qos:attention
          SELECT
            c.id                       AS conversation_id,
            p.full_name                AS patient_name,
            c.status                   AS status,
            c.channel                  AS channel,
            c.assigned_to              AS assigned_to,
            c.last_message_at          AS last_message_at,
            EXISTS (
              SELECT 1 FROM conversation_tag_links tl
              JOIN conversation_tags t ON t.id = tl.tag_id
              WHERE tl.conversation_id = c.id AND t.name = 'patient_upset'
            )                          AS upset,
            (
              SELECT lm.role FROM conversation_messages lm
              WHERE lm.conversation_id = c.id
              ORDER BY lm.created_at DESC
              LIMIT 1
            )                          AS last_role
          FROM conversations c
          LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
          WHERE c.clinic_id = ${clinicId}
            AND c.status NOT IN ('resolved', 'archived')
            AND c.created_at >= NOW() - INTERVAL '30 days'
          ORDER BY c.last_message_at ASC NULLS LAST
          LIMIT 50
        `,
      ])

      const staleCutoff = Date.now() - hours * 60 * 60 * 1000
      const items: QosAttentionItem[] = []
      for (const row of attention) {
        const lastAt = row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0
        const aged = lastAt < staleCutoff
        const clinicLast = row.lastRole === 'assistant' || row.lastRole === 'agent'
        let reason: QosAttentionItem['reason'] | null = null
        if (row.upset) reason = 'upset'
        else if (aged && clinicLast) reason = 'abandoned'
        else if (aged) reason = 'unclosed'
        if (!reason) continue
        items.push({
          conversationId: row.conversationId,
          patientName: row.patientName ?? '',
          status: row.status,
          channel: row.channel,
          reason,
          // A thread with an owner is being handled by a human secretary; an
          // unowned thread is still in pure bot auto-answer mode (mirrors the
          // inbox lens convention: owned ⇒ human, unowned ⇒ bot).
          mode: row.assignedTo ? 'human' : 'bot',
          lastMessageAt: row.lastMessageAt,
        })
      }

      return {
        upsetPatients: num(upset[0]?.total),
        upsetUnresolved: num(upset[0]?.unresolved),
        abandonedConversations: num(abandoned[0]?.count),
        avgBotResponseSeconds: Math.round(num(response[0]?.botSeconds)),
        avgSecretaryResponseSeconds: Math.round(num(response[0]?.secretarySeconds)),
        unclosedConversations: num(closure[0]?.unclosed),
        unclosedAged: num(closure[0]?.unclosedAged),
        followUpOpportunities: num(followUp[0]?.count),
        pendingFollowUps: num(pending[0]?.count),
        staleHours: hours,
        attention: items,
      }
    },
  }
}
