import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { signSessionToken } from "../auth/token.js";
import { loadEnv } from "@docmee/core";

const JWT_SECRET = "test-secret-at-least-sixteen-chars";

describe("GET /auth/session", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      JWT_SECRET,
      LOG_LEVEL: "silent",
    } as NodeJS.ProcessEnv);
    app = buildApp({ env });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/session" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("returns 401 for a token signed with the wrong secret", async () => {
    const token = signSessionToken(
      { sub: "u1", name: "Dr. A", role: "doctor", clinicId: "c1", locale: "es" },
      "a-totally-different-secret-value",
    );
    const res = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("resolves user + clinic context from a valid token", async () => {
    const token = signSessionToken(
      { sub: "u1", name: "Dr. Ana", role: "admin", clinicId: "clinic-a", locale: "es" },
      JWT_SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const session = res.json();
    expect(session).toMatchObject({
      clinicId: "clinic-a",
      role: "admin",
      locale: "es",
      user: { id: "u1", name: "Dr. Ana", role: "admin" },
    });
  });

  it("never accepts clinicId from the client (only from the token)", async () => {
    const token = signSessionToken(
      { sub: "u1", name: "Dr. Ana", role: "admin", clinicId: "clinic-a", locale: "es" },
      JWT_SECRET,
    );
    const res = await app.inject({
      method: "GET",
      url: "/auth/session?clinicId=clinic-b",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().clinicId).toBe("clinic-a");
  });
});
