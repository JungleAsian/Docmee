import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { Keyring, auth, patients, automation } from "@docmee/db";
import { exportPatient } from "./export.js";

const keyring = new Keyring({
  masterKeys: { 1: "exp-test-master-key-aaaaaaaaaaaaaaaa" },
  hmacKey: "exp-test-hmac-key-bbbbbbbbbbbbbbbbbbbb",
});

describe("SEC24 — export requires written consent", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await patients.createPatient(tx, keyring, { phone: "+50255550001" });
      patientId = p.id;
    });
  });
  afterAll(async () => h.close());

  it("blocks export without 'export' consent", async () => {
    const sent: unknown[] = [];
    const res = await exportPatient({ db: h.db }, { clinicId, patientId }, async (p) => {
      sent.push(p);
      return { ok: true };
    });
    expect(res).toEqual({ status: "blocked", reason: "no_export_consent" });
    expect(sent).toHaveLength(0); // nothing left Docmee
  });

  it("exports once written consent is recorded", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      automation.recordConsent(tx, { patientId, scope: "export", granted: true, source: "form" }),
    );
    const sent: unknown[] = [];
    const res = await exportPatient({ db: h.db }, { clinicId, patientId }, async (p) => {
      sent.push(p);
      return { ok: true };
    });
    expect(res).toEqual({ status: "exported" });
    expect(sent).toHaveLength(1);
  });
});
