import type { Session } from "@docmee/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { setToken } from "../auth";
import { apiFetch, ApiRequestError } from "./client";

describe("apiFetch", () => {
  afterEach(() => {
    // Tests may clear the cookie; restore the default token.
    setToken("test.token");
  });

  it("sends the bearer token and returns the typed body", async () => {
    const session = await apiFetch<Session>("/auth/session");
    expect(session.clinicId).toBe("cln_demo");
    expect(session.role).toBe("admin");
  });

  it("throws ApiRequestError with the envelope on 401", async () => {
    document.cookie = "docmee_token=; Path=/; Max-Age=0";
    await expect(apiFetch("/auth/session")).rejects.toBeInstanceOf(ApiRequestError);
    try {
      await apiFetch("/auth/session");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(401);
      expect((err as ApiRequestError).code).toBe("unauthorized");
    }
  });

  it("serializes a JSON body on writes", async () => {
    const created = await apiFetch<{ id: string; title?: string }>("/kb/entries", {
      method: "POST",
      body: { type: "manual", title: "Test", content: "Body" },
    });
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Test");
  });
});
