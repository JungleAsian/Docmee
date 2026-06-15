import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signPayload } from "./crm.js";

describe("CRM webhook signing", () => {
  it("produces a sha256= HMAC matching an independent computation", () => {
    const body = JSON.stringify({ patientId: "p1" });
    const expected = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    expect(signPayload(body, "secret")).toBe(expected);
  });

  it("changes when the payload changes", () => {
    expect(signPayload("a", "k")).not.toBe(signPayload("b", "k"));
  });
});
