import jwt from "jsonwebtoken";
import { z } from "zod";
import { ROLES, LOCALES, type Session } from "@docmee/contracts";
import { UnauthorizedError } from "@docmee/core";

/**
 * Session JWT claims. The clinic context (`clinicId`) is carried in the token and
 * is the ONLY source of tenant identity server-side — never accepted from the
 * request body/query (AGENTS.md: every endpoint is clinic-scoped server-side).
 */
export const sessionClaimsSchema = z.object({
  sub: z.string().min(1), // user id
  name: z.string().min(1),
  role: z.enum(ROLES),
  clinicId: z.string().min(1),
  locale: z.enum(LOCALES).default("es"),
  // Set on impersonation tokens (platform staff acting inside a clinic).
  actedByPlatformUserId: z.string().optional(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

/** Platform (IA Studio) session — no clinic context until impersonation. */
export const platformClaimsSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  kind: z.literal("platform"),
});
export type PlatformClaims = z.infer<typeof platformClaimsSchema>;

export function signPlatformToken(claims: PlatformClaims, secret: string): string {
  return jwt.sign(claims, secret, { ...HS256, expiresIn: "8h" });
}

export function verifyPlatformToken(token: string, secret: string): PlatformClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw new UnauthorizedError();
  }
  const parsed = platformClaimsSchema.safeParse(decoded);
  if (!parsed.success) throw new UnauthorizedError();
  return parsed.data;
}

const HS256: jwt.SignOptions = { algorithm: "HS256" };

/** Sign a session token. Used by login (Phase 0) and tests. */
export function signSessionToken(
  claims: SessionClaims,
  secret: string,
  opts: jwt.SignOptions = {},
): string {
  return jwt.sign(claims, secret, { ...HS256, expiresIn: "8h", ...opts });
}

/**
 * Verify + decode a bearer token into validated claims. Throws UnauthorizedError
 * (never leaks why) on any failure: bad signature, expiry, or malformed claims.
 */
export function verifySessionToken(token: string, secret: string): SessionClaims {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw new UnauthorizedError();
  }
  const parsed = sessionClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UnauthorizedError();
  }
  return parsed.data;
}

/** Project validated claims into the contract's Session shape. */
export function claimsToSession(claims: SessionClaims): Session {
  return {
    user: { id: claims.sub, name: claims.name, role: claims.role },
    clinicId: claims.clinicId,
    role: claims.role,
    locale: claims.locale,
  };
}

/** Extract a bearer token from an Authorization header (constant-ish parsing). */
export function extractBearer(header: string | undefined): string {
  if (!header) throw new UnauthorizedError();
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    throw new UnauthorizedError();
  }
  return value.trim();
}
