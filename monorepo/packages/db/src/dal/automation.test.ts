import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "./auth.js";
import { createPatient } from "./patients.js";
import { createAppointment } from "./appointments.js";
import {
  enqueueAutomation,
  cancelAutomationsForAppointment,
  hasConsent,
  recordConsent,
  hasApprovedTemplate,
  createTemplate,
  setTemplateStatus,
} from "./automation.js";

const keyring = new Keyring({
  masterKeys: { 1: "auto-test-master-key-aaaaaaaaaaaaaaaa" },
  hmacKey: "auto-test-hmac-key-bbbbbbbbbbbbbbbbbbbb",
});

describe("🔒 automation queue — idempotency, cascade, consent, templates", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;
  let appointmentId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550001" });
      patientId = p.id;
      const appt = await createAppointment(tx, {
        patientId: p.id,
        startAt: "2026-11-01T15:00:00Z",
        endAt: "2026-11-01T15:30:00Z",
      });
      appointmentId = appt.id;
    });
  });
  afterAll(async () => h.close());

  it("enqueues idempotently — no duplicate pending per appointment+type", async () => {
    const first = await h.db.withClinicContext(clinicId, (tx) =>
      enqueueAutomation(tx, { patientId, appointmentId, type: "reminder_1day" }),
    );
    const second = await h.db.withClinicContext(clinicId, (tx) =>
      enqueueAutomation(tx, { patientId, appointmentId, type: "reminder_1day" }),
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it("cancellation cascade cancels pending automations for the appointment", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      enqueueAutomation(tx, { patientId, appointmentId, type: "reminder_sameday" }),
    );
    const cancelled = await h.db.withClinicContext(clinicId, (tx) =>
      cancelAutomationsForAppointment(tx, appointmentId),
    );
    expect(cancelled).toBeGreaterThanOrEqual(2); // both reminders
  });

  it("consent ledger returns the latest decision per scope", async () => {
    expect(await h.db.withClinicContext(clinicId, (tx) => hasConsent(tx, patientId))).toBe(false);
    await h.db.withClinicContext(clinicId, (tx) =>
      recordConsent(tx, { patientId, granted: true, source: "intake" }),
    );
    expect(await h.db.withClinicContext(clinicId, (tx) => hasConsent(tx, patientId))).toBe(true);
    await h.db.withClinicContext(clinicId, (tx) =>
      recordConsent(tx, { patientId, granted: false, source: "stop" }),
    );
    expect(await h.db.withClinicContext(clinicId, (tx) => hasConsent(tx, patientId))).toBe(false);
  });

  it("only counts approved templates", async () => {
    const t = await h.db.withClinicContext(clinicId, (tx) =>
      createTemplate(tx, { name: "reminder", body: "Su cita es mañana." }),
    );
    expect(await h.db.withClinicContext(clinicId, (tx) => hasApprovedTemplate(tx, "reminder"))).toBe(false);
    await h.db.withClinicContext(clinicId, (tx) => setTemplateStatus(tx, t.id, "approved"));
    expect(await h.db.withClinicContext(clinicId, (tx) => hasApprovedTemplate(tx, "reminder"))).toBe(true);
  });
});
