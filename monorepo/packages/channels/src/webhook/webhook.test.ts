import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeMeta, verifyChallenge, verifySignature } from "./meta.js";
import { normalizeEvolution } from "./evolution.js";

describe("Meta verify-challenge", () => {
  it("echoes the challenge on a valid token", () => {
    expect(
      verifyChallenge(
        { mode: "subscribe", token: "tok", challenge: "12345" },
        "tok",
      ),
    ).toBe("12345");
  });

  it("rejects a wrong token", () => {
    expect(
      verifyChallenge({ mode: "subscribe", token: "bad", challenge: "1" }, "tok"),
    ).toBeNull();
  });

  it("rejects a non-subscribe mode", () => {
    expect(
      verifyChallenge({ mode: "x", token: "tok", challenge: "1" }, "tok"),
    ).toBeNull();
  });
});

describe("Meta signature verification", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ hello: "world" });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correct signature over the raw body", () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
  });

  it("rejects a missing / malformed header", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "nope", secret)).toBe(false);
  });
});

describe("normalizeMeta", () => {
  it("maps a WhatsApp text message", () => {
    const msgs = normalizeMeta({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "pn_1" },
                messages: [
                  { from: "50255550001", id: "wamid.1", type: "text", text: { body: "Hola" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(msgs).toEqual([
      {
        routingId: "pn_1",
        channel: "whatsapp",
        patientIdentifier: "50255550001",
        messageType: "text",
        content: "Hola",
        providerMessageId: "wamid.1",
      },
    ]);
  });

  it("ignores changes without messages (status callbacks)", () => {
    expect(
      normalizeMeta({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "pn" } } }] }] }),
    ).toEqual([]);
  });
});

describe("normalizeEvolution", () => {
  it("maps an inbound messages.upsert event", () => {
    const msgs = normalizeEvolution({
      event: "messages.upsert",
      instance: "clinic-a-inst",
      data: {
        key: { remoteJid: "50255550001@s.whatsapp.net", id: "EVO1", fromMe: false },
        message: { conversation: "Buenas" },
      },
    });
    expect(msgs[0]).toMatchObject({
      routingId: "clinic-a-inst",
      patientIdentifier: "50255550001",
      content: "Buenas",
      providerMessageId: "EVO1",
    });
  });

  it("ignores fromMe (outbound) messages", () => {
    expect(
      normalizeEvolution({
        event: "messages.upsert",
        instance: "i",
        data: { key: { remoteJid: "x@s.whatsapp.net", id: "1", fromMe: true } },
      }),
    ).toEqual([]);
  });
});
