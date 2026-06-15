import { automation, type Database } from "@docmee/db";

/**
 * Outward export (Phase 3C) with the SEC24 gate: export to Sheets/CRM REQUIRES
 * written consent (Guatemala law). Consent is checked on the 'export' scope before
 * anything leaves Docmee. The actual delivery is a caller-provided sink (CRM
 * webhook / Sheets append), keeping this unit testable and transport-agnostic.
 */
export interface ExportSink {
  (payload: Record<string, unknown>): Promise<{ ok: boolean }>;
}

export type ExportResult =
  | { status: "blocked"; reason: "no_export_consent" }
  | { status: "exported" }
  | { status: "failed" };

export async function exportPatient(
  deps: { db: Database },
  input: { clinicId: string; patientId: string },
  sink: ExportSink,
): Promise<ExportResult> {
  const consent = await deps.db.withClinicContext(input.clinicId, (tx) =>
    automation.hasConsent(tx, input.patientId, "export"),
  );
  if (!consent) return { status: "blocked", reason: "no_export_consent" };

  const payload = await deps.db.withClinicContext(input.clinicId, async (tx) => {
    const { rows } = await tx.query<{ id: string; status: string; created_at: string }>(
      `SELECT id, status, created_at FROM patients WHERE id = $1`,
      [input.patientId],
    );
    const p = rows[0];
    return { patientId: input.patientId, status: p?.status, createdAt: p?.created_at };
  });

  const res = await sink(payload);
  return res.ok ? { status: "exported" } : { status: "failed" };
}
