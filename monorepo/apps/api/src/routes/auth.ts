import type { FastifyInstance } from "fastify";
import { UnauthorizedError } from "@docmee/core";

/**
 * GET /auth/session — current user + clinic context, derived from the verified
 * JWT. This is the Sprint-0 integration seam: FE flips its mocked login to this
 * real endpoint and must round-trip (token issued → clinic context resolved).
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/session", { preHandler: app.authenticate }, async (request) => {
    if (!request.session) {
      // Defensive: authenticate always sets this or throws.
      throw new UnauthorizedError();
    }
    return request.session;
  });
}
