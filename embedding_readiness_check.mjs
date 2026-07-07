import { createServiceDbClient } from './packages/db/dist/client.js'

const keyNames = [
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'ANTHROPIC_API_KEY',
]

const env = Object.fromEntries(
  keyNames.map((name) => [
    name,
    {
      present: Boolean(process.env[name]),
      length: (process.env[name] || '').length,
      prefix: (process.env[name] || '').slice(0, 4),
    },
  ]),
)

const sql = createServiceDbClient({ url: process.env.DATABASE_URL || '' })
try {
  const rows = await sql`
    SELECT
      id,
      COALESCE(name, slug, id::text) AS clinic,
      settings -> 'aiAssistant' ->> 'embedProvider' AS embed_provider,
      settings -> 'aiAssistant' ->> 'embedModel' AS embed_model,
      settings -> 'integrations' -> 'openai' ? 'apiKeyEnc' AS has_openai_key,
      settings -> 'integrations' -> 'gemini' ? 'apiKeyEnc' AS has_gemini_key,
      settings -> 'integrations' -> 'custom' ? 'apiKeyEnc' AS has_custom_key
    FROM clinics
    ORDER BY clinic
  `
  console.log(JSON.stringify({ env, clinics: rows }, null, 2))
} finally {
  await sql.end()
}
