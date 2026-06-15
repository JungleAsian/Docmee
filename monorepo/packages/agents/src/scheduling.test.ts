import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { Keyring, auth, patients } from "@docmee/db";
import { FakeCalendarProvider } from "@docmee/integrations";
import { bookAppointment } from "./scheduling.js";

const keyring = new Keyring({
  masterKeys: { 1: "book-test-master-key-aaaaaaaaaaaaaaaa" },
  hmacKey: "book-test-hmac-key-bbbbbbbbbbbbbbbbbbbb",
});

describe("bookAppointment (no double-book)", () => {
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

  it("books when the slot is free (Calendar + local both clear)", async () => {
    const calendar = new FakeCalendarProvider();
    const res = await bookAppointment(
      { db: h.db, calendar },
      {
        clinicId,
        patientId,
        startAt: "2026-09-01T15:00:00Z",
        endAt: "2026-09-01T15:30:00Z",
        summary: "Consulta",
      },
    );
    expect(res.status).toBe("booked");
    if (res.status === "booked") expect(res.appointment.calendar_event_id).toBeTruthy();
  });

  it("returns conflict when Calendar reports the slot busy", async () => {
    const calendar = new FakeCalendarProvider();
    await calendar.createEvent({
      startAt: "2026-09-02T15:00:00Z",
      endAt: "2026-09-02T15:30:00Z",
      summary: "Existing",
    });
    const res = await bookAppointment(
      { db: h.db, calendar },
      {
        clinicId,
        patientId,
        startAt: "2026-09-02T15:15:00Z",
        endAt: "2026-09-02T15:45:00Z",
        summary: "Consulta",
      },
    );
    expect(res.status).toBe("conflict");
  });

  it("returns conflict when a local appointment overlaps even if Calendar is clear", async () => {
    const calendar = new FakeCalendarProvider();
    // First booking occupies the slot locally.
    await bookAppointment(
      { db: h.db, calendar },
      { clinicId, patientId, startAt: "2026-09-03T09:00:00Z", endAt: "2026-09-03T09:30:00Z", summary: "A" },
    );
    // A fresh calendar (clear) but the local appointment still overlaps.
    const res = await bookAppointment(
      { db: h.db, calendar: new FakeCalendarProvider() },
      { clinicId, patientId, startAt: "2026-09-03T09:15:00Z", endAt: "2026-09-03T09:45:00Z", summary: "B" },
    );
    expect(res.status).toBe("conflict");
  });
});
