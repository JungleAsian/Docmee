import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { createClinic, createClinicUser } from "./auth.js";
import {
  createDoctor,
  listDoctors,
  assignStaffToDoctor,
  listDoctorsForStaff,
} from "./doctors.js";
import { createKbEntry, retrieve } from "./kb.js";

function oneHot(index: number): number[] {
  const v = new Array<number>(1536).fill(0);
  v[index] = 1;
  return v;
}

describe("multi-doctor (Phase 3A)", () => {
  let h: TestDb;
  let clinicId: string;
  let d1: string;
  let d2: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      d1 = (await createDoctor(tx, { name: "Dra. Uno", specialty: "general" })).id;
      d2 = (await createDoctor(tx, { name: "Dr. Dos", specialty: "pediatría" })).id;
      // doctor-scoped + clinic-wide KB
      await createKbEntry(tx, { type: "manual", content: "D1 only", embedding: oneHot(0), doctorId: d1 });
      await createKbEntry(tx, { type: "manual", content: "clinic wide", embedding: oneHot(1) });
      await createKbEntry(tx, { type: "manual", content: "D2 only", embedding: oneHot(2), doctorId: d2 });
    });
  });
  afterAll(async () => h.close());

  it("lists doctors", async () => {
    const docs = await h.db.withClinicContext(clinicId, (tx) => listDoctors(tx));
    expect(docs.map((d) => d.name).sort()).toEqual(["Dr. Dos", "Dra. Uno"]);
  });

  it("doctor-scoped retrieval includes clinic-wide but excludes other doctors", async () => {
    // Querying the clinic-wide vector as D1 → returns it (doctor_id NULL allowed).
    const wide = await h.db.withClinicContext(clinicId, (tx) =>
      retrieve(tx, oneHot(1), { doctorId: d1 }),
    );
    expect(wide.map((r) => r.content)).toContain("clinic wide");

    // Querying D2's vector as D1 → excluded.
    const other = await h.db.withClinicContext(clinicId, (tx) =>
      retrieve(tx, oneHot(2), { doctorId: d1 }),
    );
    expect(other).toEqual([]);
  });

  it("assigns staff to doctors (many-to-many)", async () => {
    const staffId = (
      await h.db.withPlatformContext((tx) =>
        createClinicUser(tx, {
          clinicId,
          email: "sec@a.gt",
          name: "Sec",
          role: "secretary",
          passwordHash: "scrypt$x$y",
        }),
      )
    ).id;
    await h.db.withClinicContext(clinicId, (tx) => assignStaffToDoctor(tx, staffId, d1));
    const docs = await h.db.withClinicContext(clinicId, (tx) =>
      listDoctorsForStaff(tx, staffId),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe(d1);
  });
});
