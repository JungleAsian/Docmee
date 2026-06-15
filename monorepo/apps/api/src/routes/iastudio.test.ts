import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadEnv, hashPassword } from "@docmee/core";
import { Keyring, auth, features } from "@docmee/db";
import { createTestDb, type TestDb } from "@docmee/db/testing";
import { buildApp } from "../app.js";

const JWT_SECRET = "test-secret-at-least-sixteen-chars";
const env = loadEnv({ NODE_ENV: "test", JWT_SECRET, LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);
const keyring = new Keyring({
  masterKeys: { 1: "ia-test-master-key-aaaaaaaaaaaaaaaaaa" },
  hmacKey: "ia-test-hmac-key-bbbbbbbbbbbbbbbbbbbbbb",
});

const json = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

describe("Phase 2A — IA Studio + ops", () => {
  let h: TestDb;
  let app: FastifyInstance;
  let clinicId: string;
  let platformToken: string;
  let adminToken: string;

  beforeAll(async () => {
    h = await createTestDb();
    const clinic = await h.db.withPlatformContext((tx) =>
      auth.createClinic(tx, { name: "Clinic A", whatsappPhoneNumberId: "pn_A" }),
    );
    clinicId = clinic.id;
    await h.db.withClinicContext(clinicId, (tx) => features.setSubscription(tx, "professional"));
    await h.db.withPlatformContext(async (tx) =>
      auth.createPlatformUser(tx, {
        email: "ops@docmee.gt",
        name: "Ops",
        passwordHash: await hashPassword("pw-ops"),
      }),
    );
    await h.db.withPlatformContext(async (tx) =>
      auth.createClinicUser(tx, {
        clinicId,
        email: "admin@a.gt",
        name: "Admin",
        role: "admin",
        passwordHash: await hashPassword("pw-admin"),
      }),
    );

    app = buildApp({ env, db: h.db, keyring });
    await app.ready();

    platformToken = (
      await app.inject({
        method: "POST",
        url: "/platform/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "ops@docmee.gt", password: "pw-ops" }),
      })
    ).json().token;
    adminToken = (
      await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "admin@a.gt", password: "pw-admin" }),
      })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
    await h.close();
  });

  it("platform user lists clinics via the audited admin carve-out", async () => {
    const res = await app.inject({ method: "GET", url: "/platform/clinics", headers: json(platformToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.some((c: { id: string }) => c.id === clinicId)).toBe(true);
  });

  it("creates and lists platform feature flags", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/platform/flags",
      headers: json(platformToken),
      payload: JSON.stringify({ key: "automation", scope: "all", enabled: true }),
    });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/platform/flags", headers: json(platformToken) });
    expect(list.json().data.some((f: { key: string }) => f.key === "automation")).toBe(true);
  });

  it("impersonation is read-only: can read clinic data, cannot write", async () => {
    const imp = await app.inject({
      method: "POST",
      url: "/platform/impersonate",
      headers: json(platformToken),
      payload: JSON.stringify({ clinicId, reason: "support" }),
    });
    expect(imp.statusCode).toBe(200);
    const impToken = imp.json().token as string;

    const read = await app.inject({ method: "GET", url: "/patients", headers: json(impToken) });
    expect(read.statusCode).toBe(200); // read allowed

    const write = await app.inject({
      method: "POST",
      url: "/patients",
      headers: json(impToken),
      payload: JSON.stringify({ name: "X" }),
    });
    expect(write.statusCode).toBe(403); // platform role is read-only
  });

  it("logs the impersonation with the acting platform user", async () => {
    const count = await h.db.withClinicContext(clinicId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
         WHERE action = 'impersonation.start' AND acted_by_platform_user_id IS NOT NULL`,
      );
      return Number(rows[0]!.n);
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("admin manages quick replies and invoices", async () => {
    const qr = await app.inject({
      method: "POST",
      url: "/quick-replies",
      headers: json(adminToken),
      payload: JSON.stringify({ shortcut: "/hola", body: "¡Hola! ¿En qué le ayudo?" }),
    });
    expect(qr.statusCode).toBe(201);

    const inv = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: json(adminToken),
      payload: JSON.stringify({
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        amountCents: 34900,
      }),
    });
    expect(inv.statusCode).toBe(201);
    const invId = inv.json().id as string;

    const paid = await app.inject({
      method: "PUT",
      url: `/invoices/${invId}/status`,
      headers: json(adminToken),
      payload: JSON.stringify({ status: "paid" }),
    });
    expect(paid.json().status).toBe("paid");
  });

  it("evaluates the 3-gate feature decision for the clinic", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/features/analytics",
      headers: json(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true); // professional plan includes analytics
  });
});
