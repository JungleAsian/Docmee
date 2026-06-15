import type { ClinicTx, PlatformTx } from "../types.js";

/** Log a clinic-scoped error/event. */
export async function logError(
  tx: ClinicTx,
  type: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO error_log (clinic_id, type, detail) VALUES ($1, $2, $3)`,
    [tx.clinicId, type, detail ? JSON.stringify(detail) : null],
  );
}

/**
 * Log an UNROUTED event (decision #8): unknown phone_number_id has no clinic, so
 * it is recorded with clinic_id NULL via the privileged path, then dropped. Never
 * auto-provisions or trusts the payload.
 */
export async function logUnrouted(
  tx: PlatformTx,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `INSERT INTO error_log (clinic_id, type, detail) VALUES (NULL, $1, $2)`,
    ["unrouted_event", JSON.stringify(detail)],
  );
}
