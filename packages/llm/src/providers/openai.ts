// Only file permitted to call the OpenAI API for embeddings
import OpenAI from 'openai'

export async function embedText(text: string, apiKey?: string): Promise<number[]> {
  if (process.env['LLM_STUB'] === 'true') return new Array(1536).fill(0) as number[]
  // Per-clinic key when connected; otherwise the server env key.
  const client = new OpenAI({ apiKey: apiKey?.trim() || process.env['OPENAI_API_KEY'] })
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  })
  return response.data[0]?.embedding ?? []
}
