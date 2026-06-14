import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { type Keyring, CURRENT_KEY_VERSION } from "./keyring.js";

/**
 * App-layer field encryption (decision #2): AES-256-GCM. Postgres stores ciphertext
 * only; the key never enters the DB. The ciphertext payload is self-describing:
 *
 *   base64( iv[12] || authTag[16] || ciphertext )
 *
 * `key_version` is returned alongside and stored in its own column so the right key
 * is used on decrypt (enabling rotation later with no migration).
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Encrypted {
  ciphertext: string; // base64
  keyVersion: number;
}

export function encrypt(
  plaintext: string,
  keyring: Keyring,
  version: number = keyring.currentVersion,
): Encrypted {
  const key = keyring.encryptionKey(version);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, enc]).toString("base64"),
    keyVersion: version,
  };
}

export function decrypt(
  ciphertext: string,
  keyVersion: number,
  keyring: Keyring,
): string {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Ciphertext too short / malformed");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = raw.subarray(IV_BYTES + TAG_BYTES);
  const key = keyring.encryptionKey(keyVersion);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export { CURRENT_KEY_VERSION };
