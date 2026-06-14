import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyPassword, UnauthorizedError } from "@docmee/core";
import { type Database, auth } from "@docmee/db";
import { signSessionToken } from "../auth/token.js";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface LoginRouteOptions {
  db: Database;
  jwtSecret: string;
}

/**
 * POST /auth/login — clinic_users sign in and receive a clinic-scoped JWT (G4.8).
 * Login is uniform-time-ish: an unknown email still runs a password verify against
 * a dummy hash to avoid user-enumeration timing leaks.
 */
const DUMMY_HASH =
  "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

export async function loginRoutes(
  app: FastifyInstance,
  opts: LoginRouteOptions,
): Promise<void> {
  app.post("/auth/login", async (request) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) throw new UnauthorizedError();
    const { email, password } = parsed.data;

    const user = await opts.db.withAuthLookup((q) =>
      auth.findClinicUserByEmail(q, email),
    );

    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const token = signSessionToken(
      {
        sub: user.id,
        name: user.name,
        role: user.role,
        clinicId: user.clinicId,
        locale: "es",
      },
      opts.jwtSecret,
    );
    return { token, mustRotate: user.mustRotate };
  });
}
