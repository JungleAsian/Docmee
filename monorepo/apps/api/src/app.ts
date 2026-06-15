import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import {
  buildLoggerOptions,
  toErrorEnvelope,
  type Env,
  type NormalizedInbound,
} from "@docmee/core";
import { type Database, type Keyring, type OutboundTransport } from "@docmee/db";
import type { LlmGateway } from "@docmee/llm";
import { handleInboundMessage, createWhatsAppTransport } from "@docmee/agents";
import {
  FakeCalendarProvider,
  FakeOcrProvider,
  type CalendarProvider,
  type OcrProvider,
} from "@docmee/integrations";
import { buildGateway, createLogTransport } from "./bot.js";
import { registerAuth } from "./plugins/auth.js";
import { ReadinessRegistry } from "./health/readiness.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { loginRoutes } from "./routes/login.js";
import { panelRoutes } from "./routes/panel.js";
import { iaStudioRoutes } from "./routes/iastudio.js";
import { webhookRoutes, type WebhookConfig } from "./routes/webhooks.js";

export interface BuildAppOptions {
  env: Env;
  readiness?: ReadinessRegistry;
  /** Wired in Phase 0 when infra (X6) is present; omitted in unit tests. */
  db?: Database;
  keyring?: Keyring;
  webhook?: WebhookConfig;
  /** Override the bot's LLM gateway (defaults to real-if-keys else fakes). */
  gateway?: LlmGateway;
  /** Override the outbound transport (defaults to a log-only placeholder). */
  transport?: OutboundTransport;
  /** Override the calendar provider (defaults to an in-memory fake until X15). */
  calendar?: CalendarProvider;
  /** Override the OCR provider (defaults to a fake until X18). */
  ocr?: OcrProvider;
  /** Override the inbound enqueue step (tests inject a spy). */
  onInbound?: (msgs: NormalizedInbound[]) => void | Promise<void>;
}

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const { env, db, keyring } = opts;
  const readiness = opts.readiness ?? new ReadinessRegistry();

  const app = Fastify({
    logger: buildLoggerOptions({
      name: "api",
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV === "development",
    }),
    trustProxy: true,
  });

  // Capture the raw body (needed for Meta webhook HMAC) while still parsing JSON.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      const text = body.toString("utf8").trim();
      try {
        done(null, text ? JSON.parse(text) : {});
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if ((error as { validation?: unknown }).validation) {
      reply.code(422).send({
        error: { code: "validation_failed", message: "Request validation failed" },
      });
      return;
    }
    // Framework/plugin errors (e.g. @fastify/rate-limit 429) carry a 4xx statusCode.
    const fwStatus = (error as { statusCode?: number }).statusCode;
    if (fwStatus && fwStatus >= 400 && fwStatus < 500) {
      reply.code(fwStatus).send({
        error: {
          code: (error as { code?: string }).code ?? "error",
          message: error.message,
        },
      });
      return;
    }
    const { status, body } = toErrorEnvelope(error);
    if (status >= 500) request.log.error({ err: error }, "unhandled error");
    reply.code(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
  });

  // CORS: the panel (apps/web) is a separate origin from this API. Auth is via
  // bearer token (no cookies), so credentials aren't reflected. In production,
  // allow only CORS_ALLOWED_ORIGINS (comma-separated); in dev, allow localhost.
  const corsAllowed = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  void app.register(cors, {
    origin:
      env.NODE_ENV === "production"
        ? corsAllowed.length > 0
          ? corsAllowed
          : false
        : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, ...corsAllowed],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // SEC18: rate limiting / DoS protection. Global by default; webhooks + health
  // opt out per-route (soft enforcement — never drop patient traffic or probes).
  void app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });

  const jwtSecret = env.JWT_SECRET ?? "dev-insecure-secret-change-me-please";
  registerAuth(app, { jwtSecret });

  // Readiness checks (G4): when real infra is wired, Postgres must answer and the
  // encryption key must be present (G5 fail-fast-to-not-ready if no key).
  if (db) {
    readiness.add({
      name: "postgres",
      check: async () => {
        await db.withAuthLookup((q) => q.query("SELECT 1"));
        return true;
      },
    });
    readiness.add({ name: "crypto", check: async () => keyring != null });
  }

  const gateway = opts.gateway ?? (db ? buildGateway(env) : undefined);
  // Real WhatsApp delivery when infra is present; log-only fallback otherwise.
  const transport =
    opts.transport ??
    (db && keyring
      ? createWhatsAppTransport({ db, keyring, log: (m) => app.log.info(m) })
      : createLogTransport((msg) => app.log.info(msg)));
  const calendar = opts.calendar ?? new FakeCalendarProvider();
  const ocr = opts.ocr ?? new FakeOcrProvider();

  void app.register(healthRoutes, { readiness });
  void app.register(authRoutes);

  if (db) {
    void app.register(loginRoutes, { db, jwtSecret });
    void app.register(iaStudioRoutes, { db, jwtSecret });
  }
  if (db && keyring && gateway) {
    void app.register(panelRoutes, {
      db,
      keyring,
      transport,
      calendar,
      gateway,
      ocr,
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
    });
  }

  // Inbound webhooks. Default enqueue ingests directly (no Redis in Phase 0);
  // BullMQ replaces this step in the worker without changing the contract.
  const webhookConfig: WebhookConfig = opts.webhook ?? {
    verifyToken: env.WEBHOOK_VERIFY_TOKEN,
    appSecret: env.META_APP_SECRET,
  };

  // Default inbound path = inline processing (no Redis). When Redis is configured,
  // src/index.ts injects an `onInbound` that enqueues to the BullMQ `inbound` queue
  // for the worker to consume instead.
  const onInbound =
    opts.onInbound ??
    (async (msgs: NormalizedInbound[]) => {
      if (!db || !keyring || !gateway) return;
      for (const msg of msgs) {
        try {
          await handleInboundMessage({ db, gateway, keyring, transport }, msg);
        } catch (err) {
          app.log.error({ err, routingId: msg.routingId }, "inbound pipeline failed");
        }
      }
    });
  void app.register(webhookRoutes, { config: webhookConfig, onInbound });

  return app;
}
