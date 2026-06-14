import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("applies safe defaults in development", () => {
    const env = loadEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.NODE_ENV).toBe("development");
  });

  it("fails fast when production is missing required connection secrets", () => {
    expect(() => loadEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /JWT_SECRET is required in production/,
    );
  });

  it("accepts a complete production config", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "a-sufficiently-long-secret-value",
      DATABASE_URL: "postgres://user:pass@localhost:5432/docmee",
    } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe("production");
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("coerces PORT from a string", () => {
    const env = loadEnv({ NODE_ENV: "development", PORT: "8080" } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
  });
});
