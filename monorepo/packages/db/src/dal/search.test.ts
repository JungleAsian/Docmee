import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "./auth.js";
import { createPatient } from "./patients.js";
import { getOrCreateConversation } from "./conversations.js";
import { insertMessage, searchMessages } from "./messages.js";

const keyring = new Keyring({
  masterKeys: { 1: "se-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "se-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});

describe("per-clinic message FTS (Q3, tsvector over ciphertext bodies)", () => {
  let h: TestDb;
  let clinicA: string;
  let clinicB: string;

  beforeAll(async () => {
    h = await createTestDb();
    const a = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    const b = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "B" }));
    clinicA = a.id;
    clinicB = b.id;
    await h.db.withClinicContext(clinicA, async (tx) => {
      const p = await createPatient(tx, keyring, { phone: "+50255550001" });
      const cv = await getOrCreateConversation(tx, p.id, "whatsapp");
      await insertMessage(tx, keyring, {
        conversationId: cv.id,
        direction: "inbound",
        author: "patient",
        content: "¿Tienen parqueo disponible en la clínica?",
        providerMessageId: "w1",
      });
    });
  });
  afterAll(async () => h.close());

  it("finds a message by a word stem and decrypts the body", async () => {
    const hits = await h.db.withClinicContext(clinicA, (tx) =>
      searchMessages(tx, keyring, "parqueo"),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.body).toContain("parqueo");
  });

  it("returns nothing for an absent term", async () => {
    const hits = await h.db.withClinicContext(clinicA, (tx) =>
      searchMessages(tx, keyring, "resonancia"),
    );
    expect(hits).toEqual([]);
  });

  it("never returns another clinic's messages (G34 isolation)", async () => {
    const hits = await h.db.withClinicContext(clinicB, (tx) =>
      searchMessages(tx, keyring, "parqueo"),
    );
    expect(hits).toEqual([]);
  });

  it("stores only lexemes in content_search, never the readable plaintext", async () => {
    const raw = await h.db.withPlatformContext(async (tx) => {
      const { rows } = await tx.query<{ content_search: string }>(
        `SELECT content_search::text AS content_search FROM messages LIMIT 1`,
      );
      return rows[0]!;
    });
    // tsvector stores stems like 'parque':3 — not the full readable sentence.
    expect(raw.content_search).not.toContain("¿Tienen parqueo disponible");
    expect(raw.content_search.toLowerCase()).toContain("parqueo".slice(0, 6));
  });
});
