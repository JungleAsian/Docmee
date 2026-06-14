import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { ReadinessRegistry } from "../health/readiness.js";
import { loadEnv } from "@docmee/core";

const env = loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent" } as NodeJS.ProcessEnv);

describe("health endpoints", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("GET /health is always ok and needs no auth", async () => {
    app = buildApp({ env });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /health/ready is 200 with no registered dependencies", async () => {
    app = buildApp({ env, readiness: new ReadinessRegistry() });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(true);
  });

  it("GET /health/ready is 503 when a dependency is down", async () => {
    const readiness = new ReadinessRegistry();
    readiness.add({ name: "postgres", check: async () => true });
    readiness.add({ name: "redis", check: async () => false });
    app = buildApp({ env, readiness });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.ready).toBe(false);
    expect(body.checks).toEqual({ postgres: "up", redis: "down" });
  });
});
