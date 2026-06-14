import type { FastifyInstance, FastifyRequest } from "fastify";
import type { NormalizedInbound } from "@docmee/core";
import {
  normalizeEvolution,
  normalizeMeta,
  verifyChallenge,
  verifySignature,
} from "@docmee/channels";

export interface WebhookConfig {
  verifyToken?: string;
  appSecret?: string;
  /** Optional shared secret guarding the Evolution webhook. */
  evolutionToken?: string;
}

export interface WebhookRouteOptions {
  config: WebhookConfig;
  /** Enqueue step. Fast + non-throwing; heavy processing happens downstream. */
  onInbound: (msgs: NormalizedInbound[]) => void | Promise<void>;
}

/**
 * Meta + Evolution inbound webhooks (G6 / decision #6). The flow: verify signature
 * → ACK 200 → enqueue + normalize. Security failures (bad token/signature) return
 * 403 and are never retried (SEC: security errors are terminal).
 */
export async function webhookRoutes(
  app: FastifyInstance,
  opts: WebhookRouteOptions,
): Promise<void> {
  const { config, onInbound } = opts;

  // Meta GET verify-challenge.
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    if (!config.verifyToken) return reply.code(503).send();
    const challenge = verifyChallenge(
      { mode: q["hub.mode"], token: q["hub.verify_token"], challenge: q["hub.challenge"] },
      config.verifyToken,
    );
    if (challenge == null) return reply.code(403).send();
    return reply.code(200).type("text/plain").send(challenge);
  });

  // Meta POST receive.
  app.post("/webhooks/whatsapp", async (request, reply) => {
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const signature = request.headers["x-hub-signature-256"] as string | undefined;
    if (!config.appSecret || !raw || !verifySignature(raw, signature, config.appSecret)) {
      return reply.code(403).send();
    }
    const msgs = normalizeMeta(request.body as Parameters<typeof normalizeMeta>[0]);
    reply.code(200).send({ received: true }); // ACK first
    if (msgs.length) queueMicrotask(() => void onInbound(msgs));
    return reply;
  });

  // Evolution POST receive (interim connectivity).
  app.post("/webhooks/evolution", async (request, reply) => {
    if (config.evolutionToken) {
      const token = request.headers["x-evolution-token"] as string | undefined;
      if (token !== config.evolutionToken) return reply.code(403).send();
    }
    const msgs = normalizeEvolution(
      request.body as Parameters<typeof normalizeEvolution>[0],
    );
    reply.code(200).send({ received: true });
    if (msgs.length) queueMicrotask(() => void onInbound(msgs));
    return reply;
  });
}
