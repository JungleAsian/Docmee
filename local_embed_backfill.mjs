import { createServiceDbClient, toJson } from './packages/db/dist/client.js'
import { embed } from './packages/llm/dist/embed.js'

const sql = createServiceDbClient({ url: process.env.DATABASE_URL || '' })

try {
  await sql`
    UPDATE clinics
    SET settings = jsonb_set(
      jsonb_set(COALESCE(settings, '{}'::jsonb), '{aiAssistant}', COALESCE(settings -> 'aiAssistant', '{}'::jsonb), true),
      '{aiAssistant,embedProvider}',
      '"local"'::jsonb,
      true
    )
  `

  const chunks = await sql`
    SELECT id, clinic_id AS "clinicId", content
    FROM knowledge_chunks
    ORDER BY clinic_id, document_id, chunk_index
  `

  let embedded = 0
  for (const chunk of chunks) {
    const vector = await embed({ provider: 'local', text: chunk.content })
    await sql`
      UPDATE knowledge_chunks
      SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{embedding}', ${sql.json(
        toJson({ v: vector, provider: 'local', model: 'docmee-local-hash-1536', indexedAt: new Date().toISOString() }),
      )}::jsonb, true)
      WHERE id = ${chunk.id} AND clinic_id = ${chunk.clinicId}
    `
    embedded += 1
  }

  console.log(JSON.stringify({ clinicsUpdated: true, chunks: chunks.length, embedded }, null, 2))
} finally {
  await sql.end()
}
