import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { Keyring, auth, patients, clinics } from "@docmee/db";
import type { FetchLike } from "@docmee/channels";
import { createWhatsAppTransport } from "./transport.js";

const keyring = new Keyring({
  masterKeys: { 1: "tr-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "tr-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});

describe("WhatsApp transport (real outbound)", () => {
  let h: TestDb;
  let clinicId: string;
  let patientId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => auth.createClinic(tx, { name: "A" }));
    clinicId = c.id;
    await h.db.withClinicContext(clinicId, async (tx) => {
      const p = await patients.createPatient(tx, keyring, { phone: "50255550001" });
      patientId = p.id;
    });
  });
  afterAll(async () => h.close());

  it("degrades to logging (no provider id) when the clinic has no credentials", async () => {
    let called = false;
    const fakeFetch: FetchLike = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as FetchLike;
    const logs: string[] = [];
    const transport = createWhatsAppTransport({ db: h.db, keyring, log: (m) => logs.push(m), fetchImpl: fakeFetch });

    const res = await transport.send({ clinicId, patientId, content: "Hola" });
    expect(res).toEqual({});
    expect(called).toBe(false);
    expect(logs[0]).toMatch(/no WhatsApp credentials/);
  });

  it("delivers via the Graph API once credentials are set", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      clinics.setWhatsappCreds(tx, keyring, { phoneNumberId: "pn_1", token: "TOK" }),
    );
    let toAddr = "";
    const fakeFetch: FetchLike = (async (_url: string, init: RequestInit) => {
      toAddr = JSON.parse(init.body as string).to;
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.X" }] }) } as Response;
    }) as unknown as FetchLike;
    const transport = createWhatsAppTransport({ db: h.db, keyring, fetchImpl: fakeFetch });

    const res = await transport.send({ clinicId, patientId, content: "Hola" });
    expect(res.providerMessageId).toBe("wamid.X");
    expect(toAddr).toBe("50255550001"); // resolved + decrypted patient phone
  });
});
