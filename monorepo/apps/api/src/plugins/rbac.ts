import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError } from "@docmee/core";
import type { Role } from "@docmee/contracts";

/**
 * Role gate (architecture §6). Read endpoints allow any authenticated clinic user;
 * write endpoints are restricted (secretaries/admins operate the inbox; doctors and
 * assistants are read-only). Use as a preHandler after `authenticate`.
 */
export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest): Promise<void> {
    const session = request.session;
    if (!session) throw new UnauthorizedError();
    if (!roles.includes(session.role as Role)) {
      throw new ForbiddenError("Insufficient role");
    }
  };
}

/** Roles that may operate the inbox (write). */
export const INBOX_WRITERS: Role[] = ["admin", "secretary"];

/** Resolve the clinic id from the verified session (never from the client). */
export function clinicIdOf(request: FastifyRequest): string {
  const id = request.session?.clinicId;
  if (!id) throw new UnauthorizedError();
  return id;
}

export function actorIdOf(request: FastifyRequest): string | undefined {
  return request.session?.user?.id;
}

export type { FastifyReply };
