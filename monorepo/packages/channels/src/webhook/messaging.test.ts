import { describe, expect, it } from "vitest";
import { normalizeMessenger, normalizeInstagram } from "./messaging.js";

const payload = {
  object: "page",
  entry: [
    {
      id: "page_123",
      messaging: [
        { sender: { id: "psid_1" }, message: { mid: "m.1", text: "Hola" } },
        { sender: { id: "psid_2" }, message: { mid: "m.2", text: "echo", is_echo: true } },
      ],
    },
  ],
};

describe("Messenger / Instagram normalization", () => {
  it("maps a Messenger message and ignores echoes", () => {
    const msgs = normalizeMessenger(payload);
    expect(msgs).toEqual([
      {
        routingId: "page_123",
        channel: "messenger",
        patientIdentifier: "psid_1",
        messageType: "text",
        content: "Hola",
        providerMessageId: "m.1",
      },
    ]);
  });

  it("maps an Instagram message with the instagram channel", () => {
    const msgs = normalizeInstagram({ ...payload, object: "instagram" });
    expect(msgs[0]?.channel).toBe("instagram");
    expect(msgs[0]?.patientIdentifier).toBe("psid_1");
  });
});
