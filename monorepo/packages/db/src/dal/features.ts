import type { ClinicTx } from "../types.js";

/**
 * 3-gate feature gating (architecture §7): a feature is available only if ALL of
 *   1. a platform feature flag enables it (for 'all', the clinic's plan, or this clinic),
 *   2. the clinic's plan lists the feature, and
 *   3. the clinic has toggled it on (default ON when no explicit toggle row).
 *
 * Soft enforcement is applied by callers — gating blocks NEW activation, never a
 * live clinic's messaging.
 */
export interface FeatureDecision {
  enabled: boolean;
  reason: "ok" | "flag_off" | "plan_excludes" | "clinic_off" | "no_subscription";
}

export async function evaluateFeature(
  tx: ClinicTx,
  featureKey: string,
): Promise<FeatureDecision> {
  const sub = await tx.query<{ plan_key: string }>(
    `SELECT plan_key FROM clinic_subscriptions WHERE clinic_id = $1`,
    [tx.clinicId],
  );
  const planKey = sub.rows[0]?.plan_key;
  if (!planKey) return { enabled: false, reason: "no_subscription" };

  // Gate 1: platform flag (clinic-specific > plan > all). Absent ⇒ allowed.
  const flag = await tx.query<{ enabled: boolean }>(
    `SELECT enabled FROM platform_feature_flags
     WHERE key = $1
       AND (scope = 'all'
         OR (scope = 'plan' AND plan_key = $2)
         OR (scope = 'clinic' AND clinic_id = $3))
     ORDER BY CASE scope WHEN 'clinic' THEN 0 WHEN 'plan' THEN 1 ELSE 2 END
     LIMIT 1`,
    [featureKey, planKey, tx.clinicId],
  );
  if (flag.rows[0] && !flag.rows[0].enabled) {
    return { enabled: false, reason: "flag_off" };
  }

  // Gate 2: plan includes the feature.
  const plan = await tx.query<{ features: string[] }>(
    `SELECT features FROM plans WHERE key = $1`,
    [planKey],
  );
  const features = plan.rows[0]?.features ?? [];
  if (!features.includes(featureKey)) {
    return { enabled: false, reason: "plan_excludes" };
  }

  // Gate 3: clinic toggle (default ON).
  const toggle = await tx.query<{ enabled: boolean }>(
    `SELECT enabled FROM clinic_feature_toggles WHERE clinic_id = $1 AND feature_key = $2`,
    [tx.clinicId, featureKey],
  );
  if (toggle.rows[0] && !toggle.rows[0].enabled) {
    return { enabled: false, reason: "clinic_off" };
  }

  return { enabled: true, reason: "ok" };
}

export async function setClinicToggle(
  tx: ClinicTx,
  featureKey: string,
  enabled: boolean,
): Promise<void> {
  await tx.query(
    `INSERT INTO clinic_feature_toggles (clinic_id, feature_key, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (clinic_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [tx.clinicId, featureKey, enabled],
  );
}

export async function setSubscription(
  tx: ClinicTx,
  planKey: string,
  status: "trial" | "active" | "cancelled" = "active",
): Promise<void> {
  await tx.query(
    `INSERT INTO clinic_subscriptions (clinic_id, plan_key, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (clinic_id) DO UPDATE SET plan_key = EXCLUDED.plan_key, status = EXCLUDED.status`,
    [tx.clinicId, planKey, status],
  );
}
