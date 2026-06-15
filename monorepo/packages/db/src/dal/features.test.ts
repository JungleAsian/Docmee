import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { createClinic } from "./auth.js";
import { evaluateFeature, setClinicToggle, setSubscription } from "./features.js";

describe("3-gate feature gating", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
  });
  afterAll(async () => h.close());

  it("denies when there is no subscription", async () => {
    const d = await h.db.withClinicContext(clinicId, (tx) => evaluateFeature(tx, "automation"));
    expect(d).toEqual({ enabled: false, reason: "no_subscription" });
  });

  it("denies a feature the plan excludes", async () => {
    await h.db.withClinicContext(clinicId, (tx) => setSubscription(tx, "starter"));
    // starter plan features: inbox, scheduling (no automation)
    const d = await h.db.withClinicContext(clinicId, (tx) => evaluateFeature(tx, "automation"));
    expect(d.reason).toBe("plan_excludes");
  });

  it("allows a feature the plan includes (default clinic toggle ON)", async () => {
    const d = await h.db.withClinicContext(clinicId, (tx) => evaluateFeature(tx, "scheduling"));
    expect(d.enabled).toBe(true);
  });

  it("respects the clinic toggle (gate 3)", async () => {
    await h.db.withClinicContext(clinicId, (tx) => setClinicToggle(tx, "scheduling", false));
    const d = await h.db.withClinicContext(clinicId, (tx) => evaluateFeature(tx, "scheduling"));
    expect(d.reason).toBe("clinic_off");
  });

  it("respects a platform flag kill-switch (gate 1)", async () => {
    await h.db.withClinicContext(clinicId, (tx) => setClinicToggle(tx, "inbox", true));
    await h.db.withPlatformContext((tx) =>
      tx.query(
        `INSERT INTO platform_feature_flags (key, scope, enabled) VALUES ('inbox','all',false)`,
      ),
    );
    const d = await h.db.withClinicContext(clinicId, (tx) => evaluateFeature(tx, "inbox"));
    expect(d.reason).toBe("flag_off");
  });
});
