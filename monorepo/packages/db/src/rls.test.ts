import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./testing/pglite.js";
import { Keyring } from "./crypto/keyring.js";
import { createClinic, createClinicUser, findClinicUserByEmail } from "./dal/auth.js";
import { findPatientByPhone, setOptOut } from "./dal/patients.js";
import { countMessages } from "./dal/messages.js";
import { ingestInbound } from "./services/inbound.js";
import { sendOutbound, type OutboundTransport } from "./services/outbound.js";
import { hashPassword, verifyPassword } from "@docmee/core";

/**
 * Phase-0 acceptance gate (foundation §4) — run LIVE against PGlite (real Postgres
 * in WASM). The app path runs as the non-superuser `docmee_app` role so RLS is
 * genuinely enforced. 🔒 This suite proves cross-tenant access is impossible.
 */
const keyring = new Keyring({
  masterKeys: { 1: "unit-test-master-key-please-change-x" },
  hmacKey: "unit-test-separate-stable-hmac-key-xx",
});

const fakeTransport: OutboundTransport = {
  send: async () => ({ providerMessageId: "out_" + Math.random().toString(36).slice(2) }),
};

describe("Phase 0 — RLS tenant isolation & foundation gates", () => {
  let h: TestDb;
  let clinicA: string;
  let clinicB: string;

  beforeAll(async () => {
    h = await createTestDb(); // G4.9: migrations apply forward from empty DB
    const a = await h.db.withPlatformContext((tx) =>
      createClinic(tx, { name: "Clinic A", whatsappPhoneNumberId: "pn_A" }),
    );
    const b = await h.db.withPlatformContext((tx) =>
      createClinic(tx, { name: "Clinic B", whatsappPhoneNumberId: "pn_B" }),
    );
    clinicA = a.id;
    clinicB = b.id;
  });

  afterAll(async () => {
    await h.close();
  });

  it("G4.1 inbound message lands scoped to the routed clinic", async () => {
    const res = await ingestInbound(h.db, keyring, {
      routingId: "pn_A",
      channel: "whatsapp",
      patientIdentifier: "+50255550001",
      messageType: "text",
      content: "Hola, quiero una cita",
      providerMessageId: "wamid.A1",
    });
    expect(res.status).toBe("stored");
    if (res.status === "stored") expect(res.clinicId).toBe(clinicA);
  });

  it("G4.2 querying as Clinic B returns zero of Clinic A's rows", async () => {
    const aCount = await h.db.withClinicContext(clinicA, (tx) => countMessages(tx));
    const bCount = await h.db.withClinicContext(clinicB, (tx) => countMessages(tx));
    expect(aCount).toBe(1);
    expect(bCount).toBe(0); // RLS denies cross-tenant rows at the DB
  });

  it("G4.2b Clinic B cannot resolve Clinic A's patient by phone", async () => {
    const found = await h.db.withClinicContext(clinicB, (tx) =>
      findPatientByPhone(tx, keyring, "+50255550001"),
    );
    expect(found).toBeNull();
  });

  it("G4.4 redelivering the same wamid yields exactly one row (idempotency)", async () => {
    const again = await ingestInbound(h.db, keyring, {
      routingId: "pn_A",
      channel: "whatsapp",
      patientIdentifier: "+50255550001",
      messageType: "text",
      content: "Hola, quiero una cita",
      providerMessageId: "wamid.A1",
    });
    expect(again.status).toBe("duplicate");
    const aCount = await h.db.withClinicContext(clinicA, (tx) => countMessages(tx));
    expect(aCount).toBe(1);
  });

  it("G4.7 phone + message content are stored as ciphertext; HMAC lookup resolves", async () => {
    // Inspect raw columns via the privileged path (superuser bypasses RLS).
    const raw = await h.db.withPlatformContext(async (tx) => {
      const m = await tx.query<{ content_ciphertext: string }>(
        `SELECT content_ciphertext FROM messages LIMIT 1`,
      );
      const p = await tx.query<{ phone_ciphertext: string; phone_hmac: string }>(
        `SELECT phone_ciphertext, phone_hmac FROM patients LIMIT 1`,
      );
      return { msg: m.rows[0]!, pat: p.rows[0]! };
    });
    expect(raw.msg.content_ciphertext).not.toContain("cita");
    expect(raw.pat.phone_ciphertext).not.toContain("5555");
    expect(raw.pat.phone_hmac).toMatch(/^[0-9a-f]{64}$/);

    // HMAC lookup resolves without decryption.
    const found = await h.db.withClinicContext(clinicA, (tx) =>
      findPatientByPhone(tx, keyring, "+50255550001"),
    );
    expect(found?.phone).toBe("+50255550001"); // decrypts on read
  });

  it("G4.5 outbound to an opted-out patient is blocked at the chokepoint", async () => {
    const patient = await h.db.withClinicContext(clinicA, (tx) =>
      findPatientByPhone(tx, keyring, "+50255550001"),
    );
    const conv = await h.db.withClinicContext(clinicA, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM conversations LIMIT 1`,
      );
      return rows[0]!;
    });

    await h.db.withClinicContext(clinicA, (tx) => setOptOut(tx, patient!.id, true));
    const blocked = await sendOutbound(h.db, keyring, fakeTransport, {
      clinicId: clinicA,
      conversationId: conv.id,
      patientId: patient!.id,
      author: "staff",
      content: "Recordatorio de su cita",
    });
    expect(blocked.status).toBe("suppressed");

    await h.db.withClinicContext(clinicA, (tx) => setOptOut(tx, patient!.id, false));
    const sent = await sendOutbound(h.db, keyring, fakeTransport, {
      clinicId: clinicA,
      conversationId: conv.id,
      patientId: patient!.id,
      author: "staff",
      content: "Recordatorio de su cita",
    });
    expect(sent.status).toBe("sent");
  });

  it("G4.6 unknown phone_number_id is logged + dropped (no message row)", async () => {
    const before = await h.db.withClinicContext(clinicA, (tx) => countMessages(tx));
    const res = await ingestInbound(h.db, keyring, {
      routingId: "pn_UNKNOWN",
      channel: "whatsapp",
      patientIdentifier: "+50255559999",
      messageType: "text",
      content: "should be dropped",
      providerMessageId: "wamid.X1",
    });
    expect(res.status).toBe("unrouted");
    const after = await h.db.withClinicContext(clinicA, (tx) => countMessages(tx));
    expect(after).toBe(before); // nothing stored

    const errs = await h.db.withPlatformContext(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM error_log WHERE type = 'unrouted_event'`,
      );
      return Number(rows[0]!.n);
    });
    expect(errs).toBeGreaterThanOrEqual(1);
  });

  it("G4.8 clinic_user login lookup resolves; password verifies", async () => {
    const passwordHash = await hashPassword("s3cret-pw");
    await h.db.withPlatformContext((tx) =>
      createClinicUser(tx, {
        clinicId: clinicA,
        email: "Dra.Ana@clinicA.gt",
        name: "Dra. Ana",
        role: "admin",
        passwordHash,
      }),
    );
    const user = await h.db.withAuthLookup((q) =>
      findClinicUserByEmail(q, "dra.ana@clinica.gt"),
    );
    expect(user?.clinicId).toBe(clinicA);
    expect(user?.role).toBe("admin");
    expect(await verifyPassword("s3cret-pw", user!.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", user!.passwordHash)).toBe(false);
  });

  // R5 carve-out: the NAMED-ROLE denial (app role provably cannot cross tenants
  // even via a bug) needs a real multi-role Postgres. Gated on DATABASE_URL.
  it.todo("R5: normal app DB role is denied cross-tenant reads on real Postgres");
});
