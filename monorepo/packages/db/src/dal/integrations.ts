import type { ClinicTx } from "../types.js";

// ── Document uploads (OCR → KB) ───────────────────────────────────────────────
export async function createDocument(
  tx: ClinicTx,
  d: { filename: string },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO document_uploads (clinic_id, filename) VALUES ($1, $2) RETURNING id`,
    [tx.clinicId, d.filename],
  );
  return rows[0]!;
}

export interface DocumentView {
  id: string;
  filename: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

export async function listDocuments(tx: ClinicTx): Promise<DocumentView[]> {
  const { rows } = await tx.query<DocumentView>(
    `SELECT id, filename, status, chunk_count, created_at FROM document_uploads
     ORDER BY created_at DESC`,
  );
  return rows;
}

export async function markDocumentProcessed(
  tx: ClinicTx,
  id: string,
  chunkCount: number,
): Promise<void> {
  await tx.query(
    `UPDATE document_uploads SET status = 'processed', chunk_count = $2 WHERE id = $1`,
    [id, chunkCount],
  );
}

// ── Integration configs (Sheets / CRM) — write-only after save ────────────────
export async function saveIntegration(
  tx: ClinicTx,
  i: { type: "sheets" | "crm"; config: Record<string, unknown>; enabled?: boolean },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO clinic_integrations (clinic_id, type, config, enabled)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tx.clinicId, i.type, JSON.stringify(i.config), i.enabled ?? true],
  );
  return rows[0]!;
}

export async function getIntegration(
  tx: ClinicTx,
  type: "sheets" | "crm",
): Promise<Record<string, unknown> | null> {
  const { rows } = await tx.query<{ config: Record<string, unknown> }>(
    `SELECT config FROM clinic_integrations
     WHERE type = $1 AND enabled = true ORDER BY created_at DESC LIMIT 1`,
    [type],
  );
  return rows[0]?.config ?? null;
}

// ── Report schedules ──────────────────────────────────────────────────────────
export async function createReportSchedule(
  tx: ClinicTx,
  r: { type: string; cadence: "daily" | "weekly" | "monthly"; config?: Record<string, unknown> },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO report_schedules (clinic_id, type, cadence, config)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tx.clinicId, r.type, r.cadence, JSON.stringify(r.config ?? {})],
  );
  return rows[0]!;
}

export async function listReportSchedules(
  tx: ClinicTx,
): Promise<Array<{ id: string; type: string; cadence: string; enabled: boolean }>> {
  const { rows } = await tx.query<{ id: string; type: string; cadence: string; enabled: boolean }>(
    `SELECT id, type, cadence, enabled FROM report_schedules ORDER BY created_at DESC`,
  );
  return rows;
}
