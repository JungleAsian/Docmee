import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadEnv } from "@docmee/core";
import { buildApp } from "../app.js";

/** SEC18: rate limiting protects panel/auth; webhooks + health stay exempt. */
const env = loadEnv({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  RATE_LIMIT_MAX: "2",
  RATE_LIMIT_WINDOW: "1 minute",
} as NodeJS.ProcessEnv);

describe("rate limiting (SEC18)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns 429 after exceeding the limit on a normal route", async () => {
    app = buildApp({ env });
    await app.ready();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: "GET", url: "/auth/session" });
      codes.push(res.statusCode);
    }
    // First 2 pass the limiter (401 no token), then 429.
    expect(codes.slice(0, 2)).toEqual([401, 401]);
    expect(codes).toContain(429);
  });

  it("never rate-limits /health (liveness probe)", async () => {
    app = buildApp({ env });
    await app.ready();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "GET", url: "/health" });
      codes.push(res.statusCode);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});
