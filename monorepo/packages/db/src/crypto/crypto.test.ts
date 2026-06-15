import { describe, expect, it } from "vitest";
import { Keyring } from "./keyring.js";
import { encrypt, decrypt } from "./encryption.js";
import { hmacIdentifier, hmacEquals } from "./hmac.js";

const keyring = new Keyring({
  masterKeys: { 1: "master-key-one-aaaaaaaaaaaaaaaaaaaa", 2: "master-key-two-bbbbbbbbbbbbbbbbbbbb" },
  hmacKey: "separate-stable-hmac-key-cccccccccccc",
});

describe("encryption", () => {
  it("round-trips plaintext", () => {
    const enc = encrypt("+50255550001", keyring);
    expect(enc.ciphertext).not.toContain("5555");
    expect(decrypt(enc.ciphertext, enc.keyVersion, keyring)).toBe("+50255550001");
  });

  it("produces a fresh IV each time (non-deterministic ciphertext)", () => {
    expect(encrypt("same", keyring).ciphertext).not.toBe(encrypt("same", keyring).ciphertext);
  });

  it("records the key version used", () => {
    expect(encrypt("x", keyring).keyVersion).toBe(2); // highest = current
    expect(encrypt("x", keyring, 1).keyVersion).toBe(1);
  });

  it("decrypts with the recorded version after rotation", () => {
    const old = encrypt("legacy", keyring, 1);
    expect(decrypt(old.ciphertext, old.keyVersion, keyring)).toBe("legacy");
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const enc = encrypt("secret", keyring);
    const tampered = Buffer.from(enc.ciphertext, "base64");
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => decrypt(tampered.toString("base64"), enc.keyVersion, keyring)).toThrow();
  });
});

describe("hmac (searchable identifiers)", () => {
  it("is deterministic and normalized (trim + lowercase)", () => {
    expect(hmacIdentifier("  ABC@x.com ", keyring)).toBe(hmacIdentifier("abc@x.com", keyring));
  });

  it("differs for different inputs", () => {
    expect(hmacIdentifier("a", keyring)).not.toBe(hmacIdentifier("b", keyring));
  });

  it("is independent of the rotating encryption key (R4)", () => {
    const other = new Keyring({
      masterKeys: { 1: "totally-different-master-key-dddddddd" },
      hmacKey: "separate-stable-hmac-key-cccccccccccc", // same HMAC key
    });
    expect(hmacIdentifier("phone", keyring)).toBe(hmacIdentifier("phone", other));
  });

  it("hmacEquals compares in constant time", () => {
    const h = hmacIdentifier("x", keyring);
    expect(hmacEquals(h, h)).toBe(true);
    expect(hmacEquals(h, hmacIdentifier("y", keyring))).toBe(false);
  });
});
