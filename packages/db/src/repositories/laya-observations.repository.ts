import type { Sql } from '../client.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

export const LAYA_OBSERVATIONS_FLAG = 'docmee_laya_observations'

export interface NewLayaObservation {
  clinicId: string
  conversationId?: string | null
  workflowId: string
  workflowRevisionId?: string | null
  nodeId: string
  task: 'workflow_branch' | 'administrative_intent'
  source: 'menu_trigger' | 'menu_unmatched' | 'ai_agent'
  language: 'en' | 'es' | 'mixed' | 'unknown'
  /** Must already be redacted by the caller. */
  redactedText: string
  candidateIds: string[]
}

export interface LayaObservationAssessment {
  mode: string
  reason: string
  choiceId?: string | null
  rawScore?: number | null
  latencyMs?: number | null
}

export interface LayaObservationSummaryRow {
  task: string
  language: string
  total: number
  labeled: number
  answered: number
  comparable: number
  agreed: number
}

export interface LayaObservationReasonRow { reason: string; count: number }

/** Watch-only measurement data. Nothing here routes a patient. */
export function createLayaObservationsRepository(sql: Sql) {
  return {
    /** Opt-in is per clinic: an enabled clinic row at 100% rollout. No global switch turns capture on. */
    async isCaptureEnabled(clinicId: string): Promise<boolean> {
      if (!isUuid(clinicId)) return false
      const rows = await sql<{ enabled: boolean; rolloutPercentage: number }[]>`
        SELECT enabled, rollout_percentage FROM feature_flags
        WHERE name = ${LAYA_OBSERVATIONS_FLAG} AND clinic_id = ${clinicId}
        LIMIT 2
      `
      return rows.length === 1 && rows[0]!.enabled === true && rows[0]!.rolloutPercentage === 100
    },

    async create(input: NewLayaObservation): Promise<string | null> {
      if (!isUuid(input.clinicId) || !isUuid(input.workflowId) || !input.redactedText.trim()) return null
      const rows = await sql<{ id: string }[]>`
        INSERT INTO laya_observations (clinic_id, conversation_id, workflow_id, workflow_revision_id, node_id,
          task, source, language, redacted_text, candidate_ids)
        VALUES (${input.clinicId}, ${isUuid(input.conversationId) ? input.conversationId : null}, ${input.workflowId},
          ${isUuid(input.workflowRevisionId) ? input.workflowRevisionId : null}, ${input.nodeId.slice(0, 128)},
          ${input.task}, ${input.source}, ${input.language}, ${input.redactedText.slice(0, 1600)},
          ${sql.array(input.candidateIds.slice(0, 10).map(id => id.slice(0, 128)))})
        RETURNING id
      `
      return rows[0]?.id ?? null
    },

    async attachAssessment(clinicId: string, id: string, assessment: LayaObservationAssessment): Promise<void> {
      if (!isUuid(clinicId) || !isUuid(id)) return
      await sql`
        UPDATE laya_observations SET
          laya_mode = ${assessment.mode.slice(0, 32)},
          laya_reason = ${assessment.reason.slice(0, 32)},
          laya_choice_id = ${assessment.choiceId ? assessment.choiceId.slice(0, 128) : null},
          laya_raw_score = ${typeof assessment.rawScore === 'number' && Number.isFinite(assessment.rawScore) ? assessment.rawScore : null},
          laya_latency_ms = ${typeof assessment.latencyMs === 'number' && Number.isFinite(assessment.latencyMs) ? Math.round(assessment.latencyMs) : null}
        WHERE clinic_id = ${clinicId} AND id = ${id}
      `
    },

    /** Labels a single observation directly (AI-agent rows carry the agent's own scenario as baseline). */
    async labelById(clinicId: string, id: string, choiceId: string, source: 'next_tap' | 'ai_scenario'): Promise<void> {
      if (!isUuid(clinicId) || !isUuid(id) || !choiceId) return
      await sql`
        UPDATE laya_observations SET label_choice_id = ${choiceId.slice(0, 128)}, label_source = ${source},
          label_distance = 0, labeled_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id} AND label_choice_id IS NULL
      `
    },

    /**
     * A tap on a menu labels the still-open typed observations for that same menu in the same
     * conversation from the last `windowMinutes`. distance 0 = the most recent typed text.
     */
    async labelOpenForMenu(input: {
      clinicId: string; conversationId: string; workflowId: string; nodeId: string; choiceId: string; windowMinutes?: number
    }): Promise<number> {
      if (!isUuid(input.clinicId) || !isUuid(input.conversationId) || !isUuid(input.workflowId) || !input.choiceId) return 0
      const windowMinutes = Math.max(1, Math.min(input.windowMinutes ?? 30, 120))
      const rows = await sql<{ id: string }[]>`
        WITH open AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1 AS distance
          FROM laya_observations
          WHERE clinic_id = ${input.clinicId} AND conversation_id = ${input.conversationId}
            AND workflow_id = ${input.workflowId} AND node_id = ${input.nodeId.slice(0, 128)}
            AND task = 'workflow_branch' AND label_choice_id IS NULL
            AND created_at >= NOW() - (${windowMinutes} * INTERVAL '1 minute')
          ORDER BY created_at DESC
          LIMIT 20
        )
        UPDATE laya_observations o SET label_choice_id = ${input.choiceId.slice(0, 128)}, label_source = 'next_tap',
          label_distance = open.distance, labeled_at = NOW()
        FROM open WHERE o.id = open.id
        RETURNING o.id
      `
      return rows.length
    },

    /** Aggregate counts only: no patient text leaves this query. */
    async summary(clinicId: string, sinceDays = 90): Promise<{ rows: LayaObservationSummaryRow[]; reasons: LayaObservationReasonRow[] }> {
      if (!isUuid(clinicId)) return { rows: [], reasons: [] }
      const days = Math.max(1, Math.min(Math.floor(sinceDays), 90))
      const rows = await sql<LayaObservationSummaryRow[]>`
        SELECT task, language,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE label_choice_id IS NOT NULL)::int AS labeled,
          COUNT(*) FILTER (WHERE laya_choice_id IS NOT NULL)::int AS answered,
          COUNT(*) FILTER (WHERE label_choice_id IS NOT NULL AND laya_choice_id IS NOT NULL
            AND label_source = 'next_tap' AND label_distance = 0)::int AS comparable,
          COUNT(*) FILTER (WHERE label_choice_id IS NOT NULL AND laya_choice_id = label_choice_id
            AND label_source = 'next_tap' AND label_distance = 0)::int AS agreed
        FROM laya_observations
        WHERE clinic_id = ${clinicId} AND created_at >= NOW() - (${days} * INTERVAL '1 day')
        GROUP BY task, language
        ORDER BY task, language
      `
      const reasons = await sql<LayaObservationReasonRow[]>`
        SELECT COALESCE(laya_reason, 'not_run') AS reason, COUNT(*)::int AS count
        FROM laya_observations
        WHERE clinic_id = ${clinicId} AND created_at >= NOW() - (${days} * INTERVAL '1 day')
        GROUP BY 1 ORDER BY 2 DESC
        LIMIT 20
      `
      return { rows: [...rows], reasons: [...reasons] }
    },

    async purgeExpired(now = new Date()): Promise<number> {
      const rows = await sql<{ deletedCount: number }[]>`
        WITH purged AS (DELETE FROM laya_observations WHERE expires_at <= ${now.toISOString()} RETURNING id)
        SELECT COUNT(*)::int AS deleted_count FROM purged
      `
      return Number(rows[0]?.deletedCount ?? 0)
    },
  }
}

export type LayaObservationsRepository = ReturnType<typeof createLayaObservationsRepository>
