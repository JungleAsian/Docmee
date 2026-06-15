import type { ClinicTx } from "../types.js";

export interface PushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Save (or refresh) a Web Push subscription for a user. */
export async function savePushSubscription(
  tx: ClinicTx,
  s: { clinicUserId: string; endpoint: string; p256dh: string; auth: string },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO push_subscriptions (clinic_id, clinic_user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
     RETURNING id`,
    [tx.clinicId, s.clinicUserId, s.endpoint, s.p256dh, s.auth],
  );
  return rows[0]!;
}

export async function listSubscriptionsForUser(
  tx: ClinicTx,
  clinicUserId: string,
): Promise<PushSubscription[]> {
  const { rows } = await tx.query<PushSubscription>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE clinic_user_id = $1`,
    [clinicUserId],
  );
  return rows;
}

export async function deletePushSubscription(tx: ClinicTx, endpoint: string): Promise<void> {
  await tx.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function setNotificationPreference(
  tx: ClinicTx,
  p: { clinicUserId: string; priority: "P1" | "P2" | "P3" | "P4"; channels: string[] },
): Promise<void> {
  await tx.query(
    `INSERT INTO notification_preferences (clinic_id, clinic_user_id, priority, channels)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (clinic_user_id, priority) DO UPDATE SET channels = EXCLUDED.channels`,
    [tx.clinicId, p.clinicUserId, p.priority, p.channels],
  );
}
