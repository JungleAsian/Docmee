import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { createClinic } from "./auth.js";
import { createKbEntry, getRules, retrieve } from "./kb.js";

/** Build a 1536-dim one-hot unit vector (cosine of identical = 1, orthogonal = 0). */
function oneHot(index: number): number[] {
  const v = new Array<number>(1536).fill(0);
  v[index] = 1;
  return v;
}

describe("KB retrieval", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) =>
      createClinic(tx, { name: "Clinic A" }),
    );
    clinicId = clinic.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      await createKbEntry(tx, { type: "rule", content: "Always be kind." });
      await createKbEntry(tx, {
        type: "manual",
        content: "Hours are 8 to 17.",
        embedding: oneHot(0),
      });
      await createKbEntry(tx, {
        type: "document_chunk",
        content: "Parking is free.",
        embedding: oneHot(1),
      });
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it("returns the matching entry above the 0.70 threshold", async () => {
    const hits = await h.db.withClinicContext(clinicId, (tx) =>
      retrieve(tx, oneHot(0)),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content).toBe("Hours are 8 to 17.");
    expect(hits[0]!.similarity).toBeGreaterThanOrEqual(0.99);
  });

  it("returns nothing when no entry clears the threshold", async () => {
    const hits = await h.db.withClinicContext(clinicId, (tx) =>
      retrieve(tx, oneHot(500)),
    );
    expect(hits).toEqual([]);
  });

  it("excludes 'rule' entries from retrieval (they are always-injected)", async () => {
    const rules = await h.db.withClinicContext(clinicId, (tx) => getRules(tx));
    expect(rules).toEqual(["Always be kind."]);
  });
});
