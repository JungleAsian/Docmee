import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "../dal/auth.js";
import { createPatient, getPatientById } from "../dal/patients.js";
import { applyCapture } from "./capture.js";

const keyring = new Keyring({
  masterKeys: { 1: "capture-test-master-key-aaaaaaaaaaaa" },
  hmacKey: "capture-test-hmac-key-bbbbbbbbbbbbbbbb",
});

describe("bot data-capture allowlist (G14–G18)", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = clinic.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550001" });
      patientId = p.id;
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it("applies allowlisted ops (name, tag, status) and audits them", async () => {
    await h.db.withClinicContext(clinicId, async (tx) => {
      expect((await applyCapture(tx, { tool: "set_patient_name", patientId, name: "Juan" })).ok).toBe(true);
      expect((await applyCapture(tx, { tool: "add_patient_tag", patientId, tag: "vip" })).ok).toBe(true);
      expect((await applyCapture(tx, { tool: "set_patient_status", patientId, status: "active" })).ok).toBe(true);
    });
    const p = await h.db.withClinicContext(clinicId, (tx) =>
      getPatientById(tx, keyring, patientId),
    );
    expect(p?.name).toBe("Juan");
    expect(p?.tags).toContain("vip");
    expect(p?.status).toBe("active");

    const audits = await h.db.withClinicContext(clinicId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE action LIKE 'bot.capture:%'`,
      );
      return Number(rows[0]!.n);
    });
    expect(audits).toBe(3);
  });

  it("rejects an unknown tool (not on the allowlist)", async () => {
    const res = await h.db.withClinicContext(clinicId, (tx) =>
      applyCapture(tx, { tool: "delete_patient", patientId }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects invalid args (e.g. bad status enum)", async () => {
    const res = await h.db.withClinicContext(clinicId, (tx) =>
      applyCapture(tx, { tool: "set_patient_status", patientId, status: "deleted" }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a non-uuid patientId", async () => {
    const res = await h.db.withClinicContext(clinicId, (tx) =>
      applyCapture(tx, { tool: "set_patient_name", patientId: "x", name: "y" }),
    );
    expect(res.ok).toBe(false);
  });
});
