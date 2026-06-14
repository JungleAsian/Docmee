import { z } from "zod";

/**
 * Environment contract (G5 boot order):
 *   - env holds CONNECTION secrets only (DB/Redis/Supabase URLs + service key).
 *   - the encryption master key is fetched from Vault at boot into memory, with a
 *     host-secret-store fallback (MASTER_KEY). If neither resolves, the app must
 *     fail-fast to NOT-READY (enforced in the secrets bootstrap, not here).
 *
 * This schema validates the process env once at startup and is the single source
 * of typed config. Anything missing in production fails fast.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    // Auth — session JWT signing/verification (HS256 for Sprint 0).
    JWT_SECRET: z.string().min(16).optional(),

    // Connection secrets (provisioned by X6 — may be absent until infra is up).
    DATABASE_URL: z.string().url().optional(),
    /** Admin-role (BYPASSRLS) connection for the cross-tenant carve-out. */
    DATABASE_ADMIN_URL: z.string().url().optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
    REDIS_URL: z.string().url().optional(),

    // Crypto keys — preferably from Vault; env is the host-secret fallback.
    MASTER_KEY: z.string().min(32).optional(),
    HMAC_KEY: z.string().min(32).optional(),

    // Meta webhook (Phase 0).
    WEBHOOK_VERIFY_TOKEN: z.string().min(1).optional(),
    META_APP_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      const required: Array<keyof typeof env> = ["JWT_SECRET", "DATABASE_URL"];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parse + validate process env. Throws a readable aggregated error on failure
 * (fail-fast). `source` is injectable for tests.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
