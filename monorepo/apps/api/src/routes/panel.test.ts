import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadEnv, hashPassword } from "@docmee/core";
import { Keyring, auth, ingestInbound } from "@docmee/db";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { buildApp } from "../app.js";

const JWT_SECRET = "test-secret-at-least-sixteen-chars";
const env = loadEnv({ NODE_ENV: "test", JWT_SECRET, LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
const keyring = new Keyring({
  masterKeys: { 1: "panel-test-master-key-aaaaaaaaaaaaaa" },
  hmacKey: "panel-test-hmac-key-bbbbbbbbbbbbbbbbbb",
});

async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ email, password }),
  });
  return res.json().token as string;
}

describe("Phase 1B — panel API", () => {
  let h: TestDb;
  let app: FastifyInstance;
  let clinicId: string;
  let adminId: string;
  let adminToken: string;
  let doctorToken: string;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) =>
      auth.createClinic(tx, { name: "Clinic A", whatsappPhoneNumberId: "pn_A" }),
    );
    clinicId = clinic.id;
    const admin = await h.db.withPlatformContext(async (tx) =>
      auth.createClinicUser(tx, {
        clinicId,
        email: "admin@a.gt",
        name: "Admin",
        role: "admin",
        passwordHash: await hashPassword("pw-admin"),
      }),
    );
    adminId = admin.id;
    await h.db.withPlatformContext(async (tx) =>
      auth.createClinicUser(tx, {
        clinicId,
        email: "doc@a.gt",
        name: "Doc",
        role: "doctor",
        passwordHash: await hashPassword("pw-doc"),
      }),
    );

    app = buildApp({ env, db: h.db, keyring });
    await app.ready();
    adminToken = await login(app, "admin@a.gt", "pw-admin");
    doctorToken = await login(app, "doc@a.gt", "pw-doc");
  });

  afterAll(async () => {
    await app.close();
    await h.close();
  });

  const bearer = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

  it("creates and lists patients (admin)", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/patients",
      headers: bearer(adminToken),
      payload: JSON.stringify({ name: "Maria", phone: "+50255551234" }),
    });
    expect(create.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/patients", headers: bearer(adminToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("denies patient creation to a doctor (RBAC read-only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/patients",
      headers: bearer(doctorToken),
      payload: JSON.stringify({ name: "X" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns patient detail with notes, and adds a note", async () => {
    const list = await app.inject({ method: "GET", url: "/patients", headers: bearer(adminToken) });
    const patientId = list.json().data[0].id as string;

    const note = await app.inject({
      method: "POST",
      url: `/patients/${patientId}/notes`,
      headers: bearer(adminToken),
      payload: JSON.stringify({ body: "Called to confirm." }),
    });
    expect(note.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/patients/${patientId}`,
      headers: bearer(adminToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().notes).toHaveLength(1);
  });

  it("operates the inbox: list, staff send pauses the bot, mode + assignee", async () => {
    // Seed a conversation via inbound ingest.
    await ingestInbound(h.db, keyring, {
      routingId: "pn_A",
      channel: "whatsapp",
      patientIdentifier: "+50255559876",
      messageType: "text",
      content: "Hola",
      providerMessageId: "wamid.PANEL1",
    });

    const convs = await app.inject({ method: "GET", url: "/conversations", headers: bearer(adminToken) });
    expect(convs.statusCode).toBe(200);
    const conv = convs.json().data[0];
    expect(conv.mode).toBe("bot");

    const msgs = await app.inject({
      method: "GET",
      url: `/conversations/${conv.id}/messages`,
      headers: bearer(adminToken),
    });
    expect(msgs.json().data[0].body).toBe("Hola"); // decrypted for staff

    const send = await app.inject({
      method: "POST",
      url: `/conversations/${conv.id}/messages`,
      headers: bearer(adminToken),
      payload: JSON.stringify({ body: "Hola, soy la secretaria" }),
    });
    expect(send.statusCode).toBe(202);

    // Staff reply paused the bot.
    const convs2 = await app.inject({ method: "GET", url: "/conversations", headers: bearer(adminToken) });
    expect(convs2.json().data.find((c: { id: string }) => c.id === conv.id).mode).toBe("human");

    const assign = await app.inject({
      method: "PUT",
      url: `/conversations/${conv.id}/assignee`,
      headers: bearer(adminToken),
      payload: JSON.stringify({ assigneeId: adminId }),
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().assigneeId).toBe(adminId); // contract camelCase
  });

  it("books an appointment and rejects an overlapping slot (409)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/patients",
      headers: bearer(adminToken),
      payload: JSON.stringify({ name: "Booker", phone: "+50255550555" }),
    });
    const patientId = created.json().id as string;

    const book = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: bearer(adminToken),
      payload: JSON.stringify({
        patientId,
        startAt: "2026-10-01T15:00:00.000Z",
        endAt: "2026-10-01T15:30:00.000Z",
      }),
    });
    expect(book.statusCode).toBe(201);
    const apptId = book.json().id as string;

    const conflict = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: bearer(adminToken),
      payload: JSON.stringify({
        patientId,
        startAt: "2026-10-01T15:15:00.000Z",
        endAt: "2026-10-01T15:45:00.000Z",
      }),
    });
    expect(conflict.statusCode).toBe(409);

    const confirm = await app.inject({
      method: "PUT",
      url: `/appointments/${apptId}/status`,
      headers: bearer(adminToken),
      payload: JSON.stringify({ status: "confirmed" }),
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("confirmed");
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/patients" });
    expect(res.statusCode).toBe(401);
  });
});
