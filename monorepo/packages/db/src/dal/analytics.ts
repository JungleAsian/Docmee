import type { ClinicTx } from "../types.js";

/**
 * Per-clinic analytics rollups (Phase 2D). Aggregates store COUNTS ONLY — never
 * raw PHI (G33). Dashboards read these aggregates, never live heavy scans (G36).
 */
export interface MetricRow {
  day: string;
  metric_key: string;
  value: number;
}

async function upsertMetric(
  tx: ClinicTx,
  day: string,
  key: string,
  value: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO clinic_metrics (clinic_id, day, metric_key, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clinic_id, day, metric_key) DO UPDATE SET value = EXCLUDED.value`,
    [tx.clinicId, day, key, value],
  );
}

async function countScalar(tx: ClinicTx, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await tx.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Recompute the day's aggregates from source tables (messages, conversations,
 * appointments, audit). Idempotent — safe to re-run. `day` is YYYY-MM-DD.
 */
export async function computeDailyRollup(tx: ClinicTx, day: string): Promise<void> {
  const inbound = await countScalar(
    tx,
    `SELECT count(*)::text AS n FROM messages WHERE direction='inbound' AND created_at::date = $1`,
    [day],
  );
  const outbound = await countScalar(
    tx,
    `SELECT count(*)::text AS n FROM messages WHERE direction='outbound' AND created_at::date = $1`,
    [day],
  );
  const newConversations = await countScalar(
    tx,
    `SELECT count(*)::text AS n FROM conversations WHERE created_at::date = $1`,
    [day],
  );
  const booked = await countScalar(
    tx,
    `SELECT count(*)::text AS n FROM appointments WHERE created_at::date = $1`,
    [day],
  );
  const handoffs = await countScalar(
    tx,
    `SELECT count(*)::text AS n FROM audit_log WHERE action='bot.handoff' AND created_at::date = $1`,
    [day],
  );

  await upsertMetric(tx, day, "messages_in", inbound);
  await upsertMetric(tx, day, "messages_out", outbound);
  await upsertMetric(tx, day, "conversations_new", newConversations);
  await upsertMetric(tx, day, "appointments_booked", booked);
  await upsertMetric(tx, day, "handoffs", handoffs);
}

export async function getMetrics(
  tx: ClinicTx,
  range: { from: string; to: string },
): Promise<MetricRow[]> {
  const { rows } = await tx.query<MetricRow>(
    `SELECT day, metric_key, value FROM clinic_metrics
     WHERE day BETWEEN $1 AND $2 ORDER BY day, metric_key`,
    [range.from, range.to],
  );
  return rows;
}

// ── Error review (Phase 2D) ───────────────────────────────────────────────────
export interface ErrorRow {
  id: string;
  type: string;
  category: string | null;
  status: string;
  detail: unknown;
  created_at: string;
}

export async function listErrors(
  tx: ClinicTx,
  opts: { status?: string; limit?: number } = {},
): Promise<ErrorRow[]> {
  const { rows } = await tx.query<ErrorRow>(
    `SELECT id::text AS id, type, category, status, detail, created_at
     FROM error_log
     ${opts.status ? "WHERE status = $1" : ""}
     ORDER BY created_at DESC LIMIT ${opts.status ? "$2" : "$1"}`,
    opts.status ? [opts.status, opts.limit ?? 100] : [opts.limit ?? 100],
  );
  return rows;
}

export async function reviewError(
  tx: ClinicTx,
  id: string,
  patch: { category?: string; status?: "open" | "resolved" | "kb_suggested" },
): Promise<void> {
  await tx.query(
    `UPDATE error_log
       SET category = COALESCE($2, category),
           status = COALESCE($3, status),
           resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END
     WHERE id = $1`,
    [id, patch.category ?? null, patch.status ?? null],
  );
}

export async function createKbSuggestion(
  tx: ClinicTx,
  s: { question: string; source?: string },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO kb_improvement_suggestions (clinic_id, question, source)
     VALUES ($1, $2, $3) RETURNING id`,
    [tx.clinicId, s.question, s.source ?? null],
  );
  return rows[0]!;
}

export async function listKbSuggestions(
  tx: ClinicTx,
  status = "open",
): Promise<Array<{ id: string; question: string; status: string }>> {
  const { rows } = await tx.query<{ id: string; question: string; status: string }>(
    `SELECT id, question, status FROM kb_improvement_suggestions
     WHERE status = $1 ORDER BY created_at DESC`,
    [status],
  );
  return rows;
}
