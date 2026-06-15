import type { AdminTx, PlatformTx } from "../types.js";

/**
 * IA Studio admin DAL (Phase 2A). Platform feature flags + cross-tenant clinic
 * reads (through the audited admin carve-out) + impersonation logging. Every
 * platform-staff action stays attributable via acted_by_platform_user_id.
 */
export interface FeatureFlagInput {
  key: string;
  scope?: "all" | "plan" | "clinic";
  planKey?: string;
  clinicId?: string;
  enabled?: boolean;
}

export async function createFeatureFlag(
  tx: PlatformTx,
  f: FeatureFlagInput,
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO platform_feature_flags (key, scope, plan_key, clinic_id, enabled)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [f.key, f.scope ?? "all", f.planKey ?? null, f.clinicId ?? null, f.enabled ?? true],
  );
  return rows[0]!;
}

export async function listFeatureFlags(
  tx: PlatformTx,
): Promise<Array<{ id: string; key: string; scope: string; enabled: boolean }>> {
  const { rows } = await tx.query<{
    id: string;
    key: string;
    scope: string;
    enabled: boolean;
  }>(`SELECT id, key, scope, enabled FROM platform_feature_flags ORDER BY key`);
  return rows;
}

/** Cross-tenant clinic list for IA Studio (admin carve-out, audited by caller). */
export async function listClinics(
  tx: AdminTx,
): Promise<Array<{ id: string; name: string; status: string }>> {
  const { rows } = await tx.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM clinics ORDER BY created_at DESC`,
  );
  return rows;
}

/**
 * Record an impersonation start (read-only default, 30-min cap enforced by token
 * expiry). Written into the impersonated clinic's audit_log with the acting
 * platform user attributed.
 */
export async function logImpersonation(
  tx: PlatformTx,
  i: { clinicId: string; platformUserId: string; reason?: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_log (clinic_id, acted_by_platform_user_id, action, target, detail)
     VALUES ($1, $2, 'impersonation.start', $3, $4)`,
    [
      i.clinicId,
      i.platformUserId,
      i.clinicId,
      JSON.stringify({ reason: i.reason ?? null, readOnly: true }),
    ],
  );
}
