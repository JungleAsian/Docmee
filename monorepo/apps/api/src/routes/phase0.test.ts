import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadEnv, hashPassword } from "@docmee/core";
import { Keyring, auth, ingestInbound, messages as messagesDal } from "@docmee/db";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { buildApp } from "../app.js";

const JWT_SECRET = "test-secret-at-least-sixteen-chars";
const APP_SECRET = "meta-app-secret";
const VERIFY_TOKEN = "verify-tok";

const env = loadEnv({
  NODE_ENV: "test",
  JWT_SECRET,
  LOG_LEVEL: "silent",
} as NodeJS.ProcessEnv);

const keyring = new Keyring({
  masterKeys: { 1: "api-test-master-key-aaaaaaaaaaaaaaaa" },
  hmacKey: "api-test-hmac-key-bbbbbbbbbbbbbbbbbbbb",
});

describe("Phase 0 API — webhooks, login, readiness", () => {
  let h: TestDb;
  let app: FastifyInstance;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) =>
      auth.createClinic(tx, { name: "Clinic A", whatsappPhoneNumberId: "pn_A" }),
    );
    clinicId = clinic.id;
    await h.db.withPlatformContext(async (tx) =>
      auth.createClinicUser(tx, {
        clinicId,
        email: "ana@clinica.gt",
        name: "Dra. Ana",
        role: "admin",
        passwordHash: await hashPassword("correct-horse"),
      }),
    );

    app = buildApp({
      env,
      db: h.db,
      keyring,
      webhook: { verifyToken: VERIFY_TOKEN, appSecret: APP_SECRET },
      // Phase-0 scope: ingest only (the bot pipeline is covered in @docmee/agents).
      onInbound: async (msgs) => {
        for (const m of msgs) await ingestInbound(h.db, keyring, m);
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await h.close();
  });

  it("GET /webhooks/whatsapp echoes the challenge with a valid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("42");
  });

  it("GET /webhooks/whatsapp rejects a wrong verify token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /webhooks/whatsapp rejects a bad signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      payload: JSON.stringify({ entry: [] }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /webhooks/whatsapp accepts a signed payload and ingests it", async () => {
    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn_A" },
                messages: [
                  { from: "50255550009", id: "wamid.API1", type: "text", text: { body: "Hola" } },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig = "sha256=" + createHmac("sha256", APP_SECRET).update(payload).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
      payload,
    });
    expect(res.statusCode).toBe(200);

    // ingest runs post-ACK; give the microtask a tick.
    await new Promise((r) => setTimeout(r, 50));
    const count = await h.db.withClinicContext(clinicId, (tx) => messagesDal.countMessages(tx));
    expect(count).toBe(1);
  });

  it("POST /auth/login issues a token for valid credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "ana@clinica.gt", password: "correct-horse" }),
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe("string");
  });

  it("POST /auth/login rejects a wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: "ana@clinica.gt", password: "nope" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /health/ready reports postgres + crypto up", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().checks).toMatchObject({ postgres: "up", crypto: "up" });
  });
});
