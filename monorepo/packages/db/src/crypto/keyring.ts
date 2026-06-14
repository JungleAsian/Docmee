import { createHash } from "node:crypto";

/**
 * Key management (Phase-0 decision #2).
 *
 * - ONE global versioned encryption key; `key_version` is stored per encrypted row
 *   so rotation / per-clinic keys are possible later with no migration.
 * - The HMAC key is SEPARATE and STABLE (R4 de-risk): rotating the encryption key
 *   must never invalidate lookup hashes.
 *
 * Keys arrive as high-entropy secrets (from Vault, or the MASTER_KEY/HMAC_KEY env
 * fallback). We derive fixed 32-byte keys via SHA-256 so any sufficiently-long
 * secret yields a valid AES-256 / HMAC-256 key deterministically.
 */
export const CURRENT_KEY_VERSION = 1;

function derive32(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest(); // 32 bytes
}

export interface KeyringOptions {
  /** Encryption master secret(s) keyed by version. Version 1 is required. */
  masterKeys: Record<number, string>;
  /** Separate, stable HMAC secret for searchable identifiers. */
  hmacKey: string;
  /** Version used for new encryptions. Defaults to the highest provided. */
  currentVersion?: number;
}

export class Keyring {
  private readonly encKeys: Map<number, Buffer>;
  private readonly hmacKeyBuf: Buffer;
  readonly currentVersion: number;

  constructor(opts: KeyringOptions) {
    const versions = Object.keys(opts.masterKeys).map(Number);
    if (versions.length === 0) {
      throw new Error("Keyring requires at least one master key");
    }
    this.encKeys = new Map(versions.map((v) => [v, derive32(opts.masterKeys[v]!)]));
    this.hmacKeyBuf = derive32(opts.hmacKey);
    this.currentVersion = opts.currentVersion ?? Math.max(...versions);
    if (!this.encKeys.has(this.currentVersion)) {
      throw new Error(`No master key for current version ${this.currentVersion}`);
    }
  }

  encryptionKey(version: number): Buffer {
    const key = this.encKeys.get(version);
    if (!key) throw new Error(`Unknown key_version ${version}`);
    return key;
  }

  hmacKey(): Buffer {
    return this.hmacKeyBuf;
  }

  /**
   * Build a keyring from environment. Vault is preferred upstream; these env vars
   * are the host-secret fallback (G5). Returns null if keys are absent so callers
   * can fail-fast to NOT-READY rather than booting without crypto.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Keyring | null {
    if (!env.MASTER_KEY || !env.HMAC_KEY) return null;
    return new Keyring({
      masterKeys: { [CURRENT_KEY_VERSION]: env.MASTER_KEY },
      hmacKey: env.HMAC_KEY,
    });
  }
}
