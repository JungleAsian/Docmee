import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const status = error.statusCode ?? 500
  if (status >= 500) {
    request.log.error({ err: error }, 'request failed')
    reply.code(500).send({
      ok: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    })
    return
  }
  if (
    status === 400 &&
    (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || /JSON|property name|Unexpected token/i.test(error.message))
  ) {
    request.log.warn({ err: error }, 'invalid json request body')
    reply.code(400).send({
      ok: false,
      error: 'Invalid JSON body',
      code: 'BAD_REQUEST',
    })
    return
  }
  reply.code(status).send({
    ok: false,
    error: error.message,
    code: error.code ?? 'INTERNAL_ERROR',
  })
}

export function notFoundHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.code(404).send({ ok: false, error: 'Not found', code: 'NOT_FOUND' })
}
