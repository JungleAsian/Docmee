import { describe, expect, it } from "vitest";
import { sendWhatsAppText, type FetchLike } from "./whatsapp-send.js";

describe("sendWhatsAppText", () => {
  it("POSTs a text message to the Graph API and returns the provider id", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch: FetchLike = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.OUT1" }] }),
      } as Response;
    }) as unknown as FetchLike;

    const res = await sendWhatsAppText(
      { token: "TOK", phoneNumberId: "pn_1", baseUrl: "https://graph.test", graphVersion: "v21.0" },
      "50255550001",
      "Hola",
      fakeFetch,
    );

    expect(res.providerMessageId).toBe("wamid.OUT1");
    expect(captured!.url).toBe("https://graph.test/v21.0/pn_1/messages");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer TOK");
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "50255550001",
      type: "text",
      text: { body: "Hola" },
    });
  });

  it("throws on a non-2xx response", async () => {
    const fakeFetch: FetchLike = (async () =>
      ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as FetchLike;
    await expect(
      sendWhatsAppText({ token: "x", phoneNumberId: "p" }, "1", "y", fakeFetch),
    ).rejects.toThrow(/WhatsApp send failed: 401/);
  });
});
