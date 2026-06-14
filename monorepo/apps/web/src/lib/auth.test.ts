import { afterAll, describe, expect, it } from "vitest";
import { clearToken, getToken, setToken } from "./auth";

describe("auth token cookie", () => {
  afterAll(() => {
    // Restore the default test token for other suites.
    setToken("test.token");
  });

  it("round-trips a token through the cookie", () => {
    setToken("abc.123");
    expect(getToken()).toBe("abc.123");
  });

  it("url-encodes and decodes token values", () => {
    setToken("a b+c");
    expect(getToken()).toBe("a b+c");
  });

  it("clears the token", () => {
    setToken("to-clear");
    clearToken();
    expect(getToken()).toBeNull();
  });
});
