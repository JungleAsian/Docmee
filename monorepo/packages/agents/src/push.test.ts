import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { auth, push as pushDal } from "@docmee/db";
import { FakePushSender, type PushSender } from "@docmee/integrations";
import { notifyUserPush } from "./push.js";

describe("Web Push dispatch (Phase 3D)", () => {
  let h: TestDb;
  let clinicId: string;
  let userId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    userId = (
      await h.db.withPlatformContext((tx) =>
        auth.createClinicUser(tx, {
          clinicId,
          email: "sec@a.gt",
          name: "Sec",
          role: "secretary",
          passwordHash: "scrypt$x$y",
        }),
      )
    ).id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      await pushDal.savePushSubscription(tx, {
        clinicUserId: userId,
        endpoint: "https://push.example/a",
        p256dh: "k1",
        auth: "a1",
      });
      await pushDal.savePushSubscription(tx, {
        clinicUserId: userId,
        endpoint: "https://push.example/b",
        p256dh: "k2",
        auth: "a2",
      });
    });
  });
  afterAll(async () => h.close());

  it("sends to all of a user's subscriptions", async () => {
    const sender = new FakePushSender();
    const res = await notifyUserPush(
      { db: h.db, sender },
      { clinicId, clinicUserId: userId, message: { title: "Nuevo lead", body: "Revisa el inbox" } },
    );
    expect(res.sent).toBe(2);
    expect(sender.sent).toHaveLength(2);
  });

  it("prunes subscriptions the browser reports as gone (404/410)", async () => {
    const goneSender: PushSender = {
      name: "gone",
      send: async () => ({ ok: false, gone: true }),
    };
    const res = await notifyUserPush(
      { db: h.db, sender: goneSender },
      { clinicId, clinicUserId: userId, message: { title: "x", body: "y" } },
    );
    expect(res.pruned).toBe(2);
    const remaining = await h.db.withClinicContext(clinicId, (tx) =>
      pushDal.listSubscriptionsForUser(tx, userId),
    );
    expect(remaining).toHaveLength(0);
  });
});
