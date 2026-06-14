import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedInbound } from "@docmee/core";

/**
 * Meta webhook (G6).
 *  - GET verify-challenge: constant-time token compare, echo hub.challenge.
 *  - POST signature: timing-safe HMAC-SHA256 over the RAW body.
 *  - Normalize the WhatsApp Cloud API payload to NormalizedInbound[].
 */
export interface VerifyChallengeParams {
  mode?: string;
  token?: string;
  challenge?: string;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Returns the challenge to echo if valid, else null. */
export function verifyChallenge(
  params: VerifyChallengeParams,
  verifyToken: string,
): string | null {
  if (
    params.mode === "subscribe" &&
    params.token != null &&
    params.challenge != null &&
    safeEqual(params.token, verifyToken)
  ) {
    return params.challenge;
  }
  return null;
}

/** Verify the X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = signatureHeader.slice("sha256=".length);
  const computed = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Minimal structural typings for the WhatsApp Cloud API webhook payload.
interface MetaTextMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
}
interface MetaChangeValue {
  metadata?: { phone_number_id?: string };
  messages?: MetaTextMessage[];
}
interface MetaPayload {
  entry?: { changes?: { value?: MetaChangeValue }[] }[];
}

function mapType(t: string): NormalizedInbound["messageType"] {
  if (t === "audio" || t === "image") return t;
  if (t === "template") return "template";
  return "text";
}

/** Normalize a Meta WhatsApp payload to the internal message shape. */
export function normalizeMeta(payload: MetaPayload): NormalizedInbound[] {
  const out: NormalizedInbound[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const routingId = value?.metadata?.phone_number_id;
      if (!routingId || !value?.messages) continue;
      for (const m of value.messages) {
        out.push({
          routingId,
          channel: "whatsapp",
          patientIdentifier: m.from,
          messageType: mapType(m.type),
          content: m.text?.body ?? "",
          providerMessageId: m.id,
        });
      }
    }
  }
  return out;
}
