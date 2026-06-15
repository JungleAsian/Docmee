import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyPassword, hashPassword, UnauthorizedError, ValidationError } from "@docmee/core";
import { type Database, auth, iastudio, features } from "@docmee/db";
import {
  extractBearer,
  signPlatformToken,
  signSessionToken,
  verifyPlatformToken,
  type PlatformClaims,
} from "../auth/token.js";

export interface IaStudioRouteOptions {
  db: Database;
  jwtSecret: string;
}

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const flagBody = z.object({
  key: z.string().min(1),
  scope: z.enum(["all", "plan", "clinic"]).optional(),
  planKey: z.string().optional(),
  clinicId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});
const impersonateBody = z.object({
  clinicId: z.string().uuid(),
  reason: z.string().optional(),
});
const DUMMY_HASH = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);

/**
 * IA Studio (platform admin) API. Platform users are disjoint from clinic users
 * (decision #3) and reach clinic data only via impersonation: read-only by default
 * (role 'platform' is excluded from inbox writers), 30-min token cap, fully logged.
 */
export async function iaStudioRoutes(
  app: FastifyInstance,
  opts: IaStudioRouteOptions,
): Promise<void> {
  const { db, jwtSecret } = opts;

  const requirePlatform = async (request: FastifyRequest): Promise<PlatformClaims> => {
    const token = extractBearer(request.headers.authorization);
    return verifyPlatformToken(token, jwtSecret);
  };

  app.post("/platform/login", async (request) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) throw new UnauthorizedError();
    const user = await db.withAuthLookup((q) =>
      auth.findPlatformUserByEmail(q, parsed.data.email),
    );
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedError("Invalid credentials");
    const token = signPlatformToken(
      { sub: user.id, name: user.name, kind: "platform" },
      jwtSecret,
    );
    return { token, mustRotate: user.mustRotate };
  });

  app.get("/platform/clinics", async (request) => {
    const claims = await requirePlatform(request);
    const data = await db.withAdminContext("ia_studio_read", `clinics:${claims.sub}`, (tx) =>
      iastudio.listClinics(tx),
    );
    return { data };
  });

  // Create a clinic (onboarding, G3) + a default subscription so features gate ON.
  app.post("/platform/clinics", async (request, reply) => {
    await requirePlatform(request);
    const parsed = z
      .object({
        name: z.string().min(1),
        whatsappPhoneNumberId: z.string().optional(),
        locale: z.enum(["es", "en"]).optional(),
        plan: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const clinic = await db.withPlatformContext((tx) =>
      auth.createClinic(tx, {
        name: parsed.data.name,
        whatsappPhoneNumberId: parsed.data.whatsappPhoneNumberId,
        locale: parsed.data.locale,
      }),
    );
    await db.withClinicContext(clinic.id, (tx) =>
      features.setSubscription(tx, parsed.data.plan ?? "professional"),
    );
    reply.code(201);
    return clinic;
  });

  // Invite a clinic user (admin/secretary/doctor/assistant) with a chosen password.
  app.post("/platform/clinics/:id/users", async (request, reply) => {
    await requirePlatform(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        role: z.enum(["doctor", "secretary", "admin", "assistant"]),
        password: z.string().min(8),
      })
      .safeParse(request.body);
    if (!parsed.success) throw new ValidationError();
    const passwordHash = await hashPassword(parsed.data.password);
    const created = await db.withPlatformContext((tx) =>
      auth.createClinicUser(tx, {
        clinicId: id,
        email: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        passwordHash,
        mustRotate: false,
      }),
    );
    reply.code(201);
    return created;
  });

  app.get("/platform/flags", async (request) => {
    await requirePlatform(request);
    const data = await db.withPlatformContext((tx) => iastudio.listFeatureFlags(tx));
    return { data };
  });

  app.post("/platform/flags", async (request, reply) => {
    await requirePlatform(request);
    const parsed = flagBody.safeParse(request.body);
    if (!parsed.success) throw new UnauthorizedError();
    const created = await db.withPlatformContext((tx) =>
      iastudio.createFeatureFlag(tx, parsed.data),
    );
    reply.code(201);
    return created;
  });

  // Mint a read-only, 30-min, logged impersonation token into a clinic.
  app.post("/platform/impersonate", async (request) => {
    const claims = await requirePlatform(request);
    const parsed = impersonateBody.safeParse(request.body);
    if (!parsed.success) throw new UnauthorizedError();
    await db.withPlatformContext((tx) =>
      iastudio.logImpersonation(tx, {
        clinicId: parsed.data.clinicId,
        platformUserId: claims.sub,
        reason: parsed.data.reason,
      }),
    );
    const token = signSessionToken(
      {
        sub: claims.sub,
        name: claims.name,
        role: "platform",
        clinicId: parsed.data.clinicId,
        locale: "es",
        actedByPlatformUserId: claims.sub,
      },
      jwtSecret,
      { expiresIn: "30m" },
    );
    return { token, readOnly: true, expiresInMinutes: 30 };
  });
}
