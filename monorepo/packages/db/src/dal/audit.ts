import type { AdminTx, ClinicTx } from "../types.js";

export interface AuditEntry {
  action: string;
  target?: string;
  detail?: Record<string, unknown>;
  actorClinicUserId?: string;
}

/** Append a clinic-scoped audit record (append-only; never updated/deleted). */
export async function writeAudit(tx: ClinicTx, e: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (clinic_id, actor_clinic_user_id, action, target, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      tx.clinicId,
      e.actorClinicUserId ?? null,
      e.action,
      e.target ?? null,
      e.detail ? JSON.stringify(e.detail) : null,
    ],
  );
}

/**
 * Every use of the admin carve-out MUST be audited (decision #1 (d)). This writes
 * an audit row attributing the cross-tenant operation + reason.
 */
export async function writeAdminAudit(
  tx: AdminTx,
  detail?: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (clinic_id, action, target, detail)
     VALUES (NULL, $1, $2, $3)`,
    [
      `admin:${tx.operation}`,
      tx.reason,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}
