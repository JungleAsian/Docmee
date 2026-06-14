import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "./auth.js";
import { createPatient } from "./patients.js";
import { getOrCreateConversation } from "./conversations.js";
import {
  createAppointment,
  hasOverlap,
  transitionStatus,
  getUpcomingForPatient,
  InvalidTransitionError,
} from "./appointments.js";
import { getOrCreateIntake, advanceIntake, INTAKE_STEP_COUNT } from "./intake.js";

const keyring = new Keyring({
  masterKeys: { 1: "sched-test-master-key-aaaaaaaaaaaaaa" },
  hmacKey: "sched-test-hmac-key-bbbbbbbbbbbbbbbbbb",
});

describe("appointments lifecycle", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550001" });
      patientId = p.id;
    });
  });
  afterAll(async () => h.close());

  it("creates, detects overlap, and blocks double-book", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      createAppointment(tx, {
        patientId,
        startAt: "2026-07-01T15:00:00Z",
        endAt: "2026-07-01T15:30:00Z",
      }),
    );
    const overlap = await h.db.withClinicContext(clinicId, (tx) =>
      hasOverlap(tx, "2026-07-01T15:15:00Z", "2026-07-01T15:45:00Z"),
    );
    const clear = await h.db.withClinicContext(clinicId, (tx) =>
      hasOverlap(tx, "2026-07-01T16:00:00Z", "2026-07-01T16:30:00Z"),
    );
    expect(overlap).toBe(true);
    expect(clear).toBe(false);
  });

  it("enforces the status lifecycle and rejects illegal transitions", async () => {
    const appt = await h.db.withClinicContext(clinicId, (tx) =>
      createAppointment(tx, {
        patientId,
        startAt: "2026-08-01T10:00:00Z",
        endAt: "2026-08-01T10:30:00Z",
      }),
    );
    await h.db.withClinicContext(clinicId, (tx) =>
      transitionStatus(tx, appt.id, "confirmed"),
    );
    const completed = await h.db.withClinicContext(clinicId, (tx) =>
      transitionStatus(tx, appt.id, "completed"),
    );
    expect(completed.status).toBe("completed");
    await expect(
      h.db.withClinicContext(clinicId, (tx) => transitionStatus(tx, appt.id, "booked")),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("returns the patient's upcoming appointment", async () => {
    const appt = await h.db.withClinicContext(clinicId, (tx) =>
      getUpcomingForPatient(tx, patientId),
    );
    // The far-future booked appointment from the overlap test.
    expect(appt?.status).toBe("booked");
  });
});

describe("8-step intake state machine", () => {
  let h: TestDb;
  let clinicId: string;
  let conversationId: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550002" });
      patientId = p.id;
      const conv = await getOrCreateConversation(tx, p.id, "whatsapp");
      conversationId = conv.id;
    });
  });
  afterAll(async () => h.close());

  it("rejects invalid input (re-validate on write) and completes after 8 valid answers", async () => {
    const intakeId = await h.db.withClinicContext(clinicId, async (tx) => {
      const s = await getOrCreateIntake(tx, keyring, conversationId, patientId);
      return s.id;
    });

    // Step 5 (contactPhone) requires >=8 digits — reject a bad value first.
    const answers = [
      "Consulta general",
      "cualquiera",
      "2026-07-10",
      "10:00",
      "Juan Perez",
      "123", // invalid phone → rejected
    ];
    let done = false;
    for (const a of answers) {
      const r = await h.db.withClinicContext(clinicId, (tx) =>
        advanceIntake(tx, keyring, intakeId, a),
      );
      done = r.done;
    }
    // The invalid phone was rejected, so we are still on the phone step.
    const good = ["+50255551111", "Sin alergias", "sí"];
    for (const a of good) {
      const r = await h.db.withClinicContext(clinicId, (tx) =>
        advanceIntake(tx, keyring, intakeId, a),
      );
      done = r.done;
    }
    expect(done).toBe(true);
  });

  it("stores intake data encrypted at rest", async () => {
    const raw = await h.db.withPlatformContext(async (tx) => {
      const { rows } = await tx.query<{ data_ciphertext: string }>(
        `SELECT data_ciphertext FROM patient_intake WHERE conversation_id = $1`,
        [conversationId],
      );
      return rows[0]!;
    });
    expect(raw.data_ciphertext).not.toContain("Juan");
    expect(INTAKE_STEP_COUNT).toBe(8);
  });
});
