import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  buildLoggerOptions,
  toErrorEnvelope,
  type Env,
  type NormalizedInbound,
} from "@docmee/core";
import {
  ingestInbound,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import type { LlmGateway } from "@docmee/llm";
import { processTurn } from "@docmee/agents";
import { buildGateway, createLogTransport } from "./bot.js";
import { registerAuth } from "./plugins/auth.js";
import { ReadinessRegistry } from "./health/readiness.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { loginRoutes } from "./routes/login.js";
import { panelRoutes } from "./routes/panel.js";
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
    const { status, body } = toErrorEnvelope(error);
    if (status >= 500) request.log.error({ err: error }, "unhandled error");
    reply.code(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
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
  const transport =
    opts.transport ?? createLogTransport((msg) => app.log.info(msg));

  void app.register(healthRoutes, { readiness });
  void app.register(authRoutes);

  if (db) {
    void app.register(loginRoutes, { db, jwtSecret });
  }
  if (db && keyring) {
    void app.register(panelRoutes, { db, keyring, transport });
  }

  // Inbound webhooks. Default enqueue ingests directly (no Redis in Phase 0);
  // BullMQ replaces this step in the worker without changing the contract.
  const webhookConfig: WebhookConfig = opts.webhook ?? {
    verifyToken: env.WEBHOOK_VERIFY_TOKEN,
    appSecret: env.META_APP_SECRET,
  };

  const onInbound =
    opts.onInbound ??
    (async (msgs: NormalizedInbound[]) => {
      if (!db || !keyring || !gateway) return;
      for (const msg of msgs) {
        try {
          const res = await ingestInbound(db, keyring, msg);
          // Auto-reply only for freshly stored inbound (not redeliveries).
          if (res.status === "stored") {
            await processTurn(
              { db, gateway, keyring, transport },
              {
                clinicId: res.clinicId,
                conversationId: res.conversationId,
                patientId: res.patientId,
                text: msg.content,
              },
            );
          }
        } catch (err) {
          app.log.error({ err, routingId: msg.routingId }, "inbound pipeline failed");
        }
      }
    });
  void app.register(webhookRoutes, { config: webhookConfig, onInbound });

  return app;
}
