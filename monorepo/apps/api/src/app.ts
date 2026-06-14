import Fastify, { type FastifyInstance } from "fastify";
import { buildLoggerOptions, toErrorEnvelope, type Env } from "@docmee/core";
import { registerAuth } from "./plugins/auth.js";
import { ReadinessRegistry } from "./health/readiness.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";

export interface BuildAppOptions {
  env: Env;
  /** Injectable for tests / Phase-0 dependency wiring. */
  readiness?: ReadinessRegistry;
}

/**
 * Assemble the Fastify app. Pure factory (no listen) so tests drive it via
 * `app.inject(...)`. The same instance is started by `src/index.ts`.
 */
export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const { env } = opts;
  const readiness = opts.readiness ?? new ReadinessRegistry();

  const app = Fastify({
    // Pass pino OPTIONS (with SEC16 redaction) so Fastify builds the logger and
    // keeps its default logger typing.
    logger: buildLoggerOptions({
      name: "api",
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV === "development",
    }),
    // Trust the proxy (Caddy) for client IP — needed for rate limiting (SEC18) later.
    trustProxy: true,
  });

  // Deterministic error → envelope mapping. Never leak internals.
  app.setErrorHandler((error, request, reply) => {
    // Fastify schema validation → 422 validation envelope.
    if ((error as { validation?: unknown }).validation) {
      reply.code(422).send({
        error: { code: "validation_failed", message: "Request validation failed" },
      });
      return;
    }
    const { status, body } = toErrorEnvelope(error);
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
    }
    reply.code(status).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
  });

  const jwtSecret = env.JWT_SECRET ?? "dev-insecure-secret-change-me-please";
  registerAuth(app, { jwtSecret });

  void app.register(healthRoutes, { readiness });
  void app.register(authRoutes);

  return app;
}
