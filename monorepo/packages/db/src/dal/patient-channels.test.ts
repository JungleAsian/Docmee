import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { Keyring } from "../crypto/keyring.js";
import { createClinic } from "./auth.js";
import { listChannelIdentities, mergePatients } from "./patient-channels.js";
import { listConversations } from "./conversations.js";
import { ingestInbound } from "../services/inbound.js";

const keyring = new Keyring({
  masterKeys: { 1: "pc-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "pc-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});

describe("multi-channel identities + merge (Phase 2B)", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) =>
      createClinic(tx, { name: "A", whatsappPhoneNumberId: "pn_A" }),
    );
    clinicId = c.id;
    await h.db.withPlatformContext((tx) =>
      tx.query(`UPDATE clinics SET messenger_page_id = 'pg_A' WHERE id = $1`, [clinicId]),
    );
  });
  afterAll(async () => h.close());

  it("routes WhatsApp and Messenger to the same clinic as distinct patients", async () => {
    const wa = await ingestInbound(h.db, keyring, {
      routingId: "pn_A",
      channel: "whatsapp",
      patientIdentifier: "+50255550001",
      messageType: "text",
      content: "Hola WA",
      providerMessageId: "wamid.1",
    });
    const fb = await ingestInbound(h.db, keyring, {
      routingId: "pg_A",
      channel: "messenger",
      patientIdentifier: "psid_1",
      messageType: "text",
      content: "Hola FB",
      providerMessageId: "m.1",
    });
    expect(wa.status).toBe("stored");
    expect(fb.status).toBe("stored");
    if (wa.status === "stored" && fb.status === "stored") {
      expect(wa.patientId).not.toBe(fb.patientId);
    }
  });

  it("merges two patients into one unified profile across channels", async () => {
    const [wa, fb] = await Promise.all([
      h.db.withClinicContext(clinicId, async (tx) => {
        const { rows } = await tx.query<{ patient_id: string }>(
          `SELECT patient_id FROM patient_channel_identities WHERE channel = 'whatsapp' LIMIT 1`,
        );
        return rows[0]!.patient_id;
      }),
      h.db.withClinicContext(clinicId, async (tx) => {
        const { rows } = await tx.query<{ patient_id: string }>(
          `SELECT patient_id FROM patient_channel_identities WHERE channel = 'messenger' LIMIT 1`,
        );
        return rows[0]!.patient_id;
      }),
    ]);

    await h.db.withClinicContext(clinicId, (tx) => mergePatients(tx, wa, fb));

    const convs = await h.db.withClinicContext(clinicId, (tx) =>
      listConversations(tx, {}),
    );
    // Both conversations now belong to the primary patient.
    expect(convs.filter((c) => c.patient_id === wa)).toHaveLength(2);

    const ids = await h.db.withClinicContext(clinicId, (tx) =>
      listChannelIdentities(tx, wa),
    );
    expect(ids.map((i) => i.channel).sort()).toEqual(["messenger", "whatsapp"]);
  });
});
