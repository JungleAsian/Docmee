import { pino, type Logger, type LoggerOptions } from "pino";

/**
 * SEC16: never log message bodies / PHI. This is the ONLY sanctioned logger.
 * It hard-redacts known sensitive keys at every level. `no-console` lint forbids
 * the alternatives, so PHI cannot leak through ad-hoc logging.
 *
 * Redaction is defense-in-depth: callers must still avoid passing raw patient
 * content into the logger at all.
 */
const REDACT_KEYS = [
  "password",
  "token",
  "authorization",
  "apiKey",
  "api_key",
  "secret",
  "phone",
  "channel_id",
  "channelId",
  "content",
  "body",
  "reason",
  "special_notes",
  "specialNotes",
  "raw_payload",
  "rawPayload",
  "email",
];

// Redact both top-level and one-level-nested occurrences of each sensitive key.
const REDACT_PATHS = REDACT_KEYS.flatMap((k) => [k, `*.${k}`]);

export type { Logger } from "pino";

export interface CreateLoggerOptions {
  name?: string;
  level?: string;
  /** Pretty-print for local dev; JSON otherwise. */
  pretty?: boolean;
}

/**
 * Build pino options with SEC16 redaction baked in. Exposed separately so the API
 * can hand these to Fastify's `logger` option (keeping Fastify's default logger
 * typing) instead of injecting a pre-built instance.
 */
export function buildLoggerOptions(opts: CreateLoggerOptions = {}): LoggerOptions {
  const options: LoggerOptions = {
    name: opts.name ?? "docmee",
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: undefined, // drop pid/hostname noise
  };
  if (opts.pretty) {
    options.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  return options;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  return pino(buildLoggerOptions(opts));
}

/** Default process logger. Apps usually create their own named child. */
export const logger = createLogger();
