// Zod request validation helper (P08). On failure it sends a 400 with the flattened
// ZodError and returns { ok: false }; callers `if (!parsed.ok) return`.
import type { FastifyReply } from 'fastify'
import { z } from 'zod'

export function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  reply: FastifyReply,
): { ok: true; data: z.infer<S> } | { ok: false } {
  const result = schema.safeParse(data)
  if (!result.success) {
    reply.code(400).send({ error: 'Validation failed', details: result.error.flatten() })
    return { ok: false }
  }
  return { ok: true, data: result.data }
}
