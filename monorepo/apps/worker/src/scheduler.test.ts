import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import {
  Keyring,
  auth,
  patients,
  appointments,
  type OutboundTransport,
} from "@docmee/db";
import { runScheduledTick, runDailyRollups } from "./scheduler.js";

const keyring = new Keyring({
  masterKeys: { 1: "wk-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "wk-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});
const transport: OutboundTransport = { send: async () => ({}) };

describe("worker scheduled jobs (architecture §12)", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await patients.createPatient(tx, keyring, { phone: "+50255550001" });
      // An appointment that ended well over 30 min ago → due for completion.
      await appointments.createAppointment(tx, {
        patientId: p.id,
        startAt: "2020-01-01T10:00:00Z",
        endAt: "2020-01-01T10:30:00Z",
      });
    });
  });
  afterAll(async () => h.close());

  it("auto-completes overdue appointments across active clinics", async () => {
    const summary = await runScheduledTick({ db: h.db, keyring, transport });
    expect(summary.clinics).toBe(1);
    expect(summary.completed).toBe(1);

    const completed = await h.db.withClinicContext(clinicId, (tx) =>
      appointments.listAppointments(tx, { status: "completed" }),
    );
    expect(completed).toHaveLength(1);
  });

  it("is idempotent — a second tick completes nothing new", async () => {
    const summary = await runScheduledTick({ db: h.db, keyring, transport });
    expect(summary.completed).toBe(0);
  });

  it("runs daily rollups across clinics", async () => {
    const day = await h.db.withClinicContext(clinicId, async (tx) => {
      const { rows } = await tx.query<{ d: string }>(`SELECT current_date::text AS d`);
      return rows[0]!.d;
    });
    const n = await runDailyRollups({ db: h.db }, day);
    expect(n).toBe(1);
  });
});
