import { createHmac, timingSafeEqual } from "node:crypto";
import { type Keyring } from "./keyring.js";

/**
 * Searchable-identifier hashing (decision #2). Encrypted columns (phone, channel_id)
 * cannot be used in WHERE/sort; instead we store a companion HMAC hash column and
 * look up by hashing the query value with the SEPARATE, STABLE HMAC key.
 *
 * Normalization: identifiers are trimmed + lowercased so the same logical value
 * always hashes identically. Equality lookups work; range/substring/sort do not
 * (by design — a future need = a purpose-built derived field, never ciphertext).
 */
export function hmacIdentifier(value: string, keyring: Keyring): string {
  const normalized = value.trim().toLowerCase();
  return createHmac("sha256", keyring.hmacKey()).update(normalized, "utf8").digest("hex");
}

/** Constant-time comparison of two hex HMAC digests. */
export function hmacEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
