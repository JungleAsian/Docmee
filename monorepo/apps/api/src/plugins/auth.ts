import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "@docmee/contracts";
import { extractBearer, verifySessionToken, claimsToSession } from "../auth/token.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by the `authenticate` preHandler from the verified JWT. */
    session?: Session;
  }
  interface FastifyInstance {
    /** preHandler that requires a valid bearer token and sets `request.session`. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthOptions {
  jwtSecret: string;
}

/**
 * Wires JWT authentication onto the Fastify instance. The `authenticate`
 * preHandler is the single chokepoint that resolves tenant identity from the
 * token; routes must never read `clinicId` from the client.
 */
export function registerAuth(app: FastifyInstance, opts: AuthOptions): void {
  app.decorateRequest("session", undefined);

  app.decorate("authenticate", async function (request: FastifyRequest): Promise<void> {
    const token = extractBearer(request.headers.authorization);
    const claims = verifySessionToken(token, opts.jwtSecret);
    request.session = claimsToSession(claims);
  });
}
