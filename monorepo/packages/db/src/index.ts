/**
 * @docmee/db — Supabase/Postgres data-access layer. OWNER: Prime. Migrations append-only.
 *
 * Public surface only. The raw connection pool (pool.ts) and the PGlite test
 * harness (testing/) are intentionally NOT exported — the only doors to clinic
 * data are the methods on `Database`.
 */
import { Database } from "./database.js";
import { createPgProvider } from "./pool.js";

export { Database } from "./database.js";
export type { DatabaseOptions } from "./database.js";
export type {
  ClinicTx,
  AdminTx,
  AdminOperation,
  PlatformTx,
  Queryable,
  QueryResult,
} from "./types.js";

// Crypto
export { Keyring, CURRENT_KEY_VERSION } from "./crypto/keyring.js";
export type { KeyringOptions } from "./crypto/keyring.js";
export { encrypt, decrypt } from "./crypto/encryption.js";
export type { Encrypted } from "./crypto/encryption.js";
export { hmacIdentifier, hmacEquals } from "./crypto/hmac.js";

// Migrations
export { runMigrations } from "./migrate/runner.js";
export type { Migration, MigrateResult } from "./migrate/runner.js";
export { migrations } from "./migrate/migrations/index.js";

// DAL
export * as patients from "./dal/patients.js";
export * as conversations from "./dal/conversations.js";
export * as messages from "./dal/messages.js";
export * as audit from "./dal/audit.js";
export * as errors from "./dal/errors.js";
export * as auth from "./dal/auth.js";
export * as kb from "./dal/kb.js";
export { RETRIEVAL_THRESHOLD } from "./dal/kb.js";
export * as notes from "./dal/notes.js";
export * as notifications from "./dal/notifications.js";
export * as appointments from "./dal/appointments.js";
export { InvalidTransitionError, type AppointmentStatus } from "./dal/appointments.js";
export * as intake from "./dal/intake.js";
export { INTAKE_STEPS, INTAKE_STEP_COUNT, type IntakeState } from "./dal/intake.js";

// Bot data-capture allowlist (G14–G18)
export { applyCapture, CAPTURE_TOOLS, type CaptureOp, type CaptureResult } from "./services/capture.js";

// Services
export { ingestInbound } from "./services/inbound.js";
export type { NormalizedInbound, IngestResult } from "./services/inbound.js";
export { sendOutbound } from "./services/outbound.js";
export type {
  OutboundTransport,
  OutboundParams,
  OutboundResult,
} from "./services/outbound.js";

/** True when a live Postgres is configured (gates integration tests until X6). */
export function isLiveDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export interface CreateDatabaseOptions {
  /** App-role connection string (RLS-bound). */
  databaseUrl: string;
  /** Admin-role connection string (BYPASSRLS) for the cross-tenant carve-out. */
  adminDatabaseUrl?: string;
}

/** Build a production Database backed by node-postgres pools. */
export function createDatabase(opts: CreateDatabaseOptions): Database {
  return new Database({
    app: createPgProvider(opts.databaseUrl),
    admin: opts.adminDatabaseUrl ? createPgProvider(opts.adminDatabaseUrl) : undefined,
  });
}
