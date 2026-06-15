import type { FastifyInstance } from "fastify";
import type { ReadinessRegistry } from "../health/readiness.js";

export interface HealthRouteOptions {
  readiness: ReadinessRegistry;
}

/**
 * Liveness + readiness. `/health` answers as long as the process is up;
 * `/health/ready` reflects dependency health and is the gate-measured endpoint.
 * Neither requires authentication.
 */
export async function healthRoutes(
  app: FastifyInstance,
  opts: HealthRouteOptions,
): Promise<void> {
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  app.get("/health/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    const result = await opts.readiness.evaluate();
    reply.code(result.ready ? 200 : 503);
    return result;
  });
}
