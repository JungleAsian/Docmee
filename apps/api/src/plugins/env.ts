import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  APP_URL: z.string().default('http://localhost:3000'),
  SUPABASE_URL: z.string().default('http://localhost:54321'),
  SUPABASE_ANON_KEY: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LLM_STUB: z.coerce.boolean().default(true),
  WEBHOOK_TARGET: z.string().default('http://localhost:3001/webhook/whatsapp'),
  // Auth (P08). Dev defaults keep local boot working; production must override.
  JWT_SECRET: z.string().default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-refresh-secret-change-me'),
  // Feature flags (Req 40). Off by default; opt in with 1/true/yes/on (case-insensitive).
  // NOTE: do NOT use z.coerce.boolean() here — it treats the string 'false' as true.
  FEATURE_ADVANCED_ANALYTICS: z
    .string()
    .default('false')
    .transform((v) => /^(1|true|yes|on)$/i.test(v.trim())),
})

export type Env = z.infer<typeof schema>

const DEV_JWT_SECRET = 'dev-access-secret-change-me'
const DEV_JWT_REFRESH_SECRET = 'dev-refresh-secret-change-me'

export function parseEnv(): Env {
  const env = schema.parse(process.env)
  // Fail closed in production: the dev JWT fallbacks are committed in the repo,
  // so booting with them (or empty values) would let anyone forge an admin token
  // for any clinic. Dev/test still use the defaults.
  if (env.NODE_ENV === 'production') {
    const weak: string[] = []
    if (!process.env['JWT_SECRET'] || env.JWT_SECRET === DEV_JWT_SECRET) weak.push('JWT_SECRET')
    if (!process.env['JWT_REFRESH_SECRET'] || env.JWT_REFRESH_SECRET === DEV_JWT_REFRESH_SECRET) weak.push('JWT_REFRESH_SECRET')
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) weak.push('JWT_SECRET and JWT_REFRESH_SECRET must differ')
    if (weak.length > 0) {
      throw new Error(`Refusing to boot in production with missing/default JWT secrets: ${weak.join(', ')}.`)
    }
  }
  return env
}
