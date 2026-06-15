import { push as pushDal, type Database } from "@docmee/db";
import type { PushMessage, PushSender } from "@docmee/integrations";

/**
 * Push dispatch (Phase 3D). Sends a Web Push message to all of a user's
 * subscriptions and prunes any the browser reports as gone (404/410).
 */
export interface PushDeps {
  db: Database;
  sender: PushSender;
}

export async function notifyUserPush(
  deps: PushDeps,
  input: { clinicId: string; clinicUserId: string; message: PushMessage },
): Promise<{ sent: number; pruned: number }> {
  const { db, sender } = deps;
  const subs = await db.withClinicContext(input.clinicId, (tx) =>
    pushDal.listSubscriptionsForUser(tx, input.clinicUserId),
  );
  let sent = 0;
  let pruned = 0;
  for (const s of subs) {
    const res = await sender.send(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      input.message,
    );
    if (res.ok) {
      sent++;
    } else if (res.gone) {
      await db.withClinicContext(input.clinicId, (tx) =>
        pushDal.deletePushSubscription(tx, s.endpoint),
      );
      pruned++;
    }
  }
  return { sent, pruned };
}
