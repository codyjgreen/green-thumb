import type { FastifyError } from 'fastify';

export default function errorHandlerPlugin(
  error: FastifyError,
  _request: unknown,
  reply: { code: (n: number) => { send: (body: unknown) => unknown } }
) {
  const statusCode = error.statusCode || 500;

  if (error.name === 'ZodError') {
    return reply.code(400).send({ statusCode: 400, message: 'Validation error', error: error.message });
  }

  if (error.statusCode === 400 || error.validation) {
    return reply.code(400).send({ statusCode: 400, message: error.message });
  }

  if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
    return reply.code(401).send({ statusCode: 401, message: 'Invalid or missing authorization token' });
  }

  return reply.code(statusCode).send({
    statusCode,
    message: error.message,
    error: error.name || 'Error',
  });
}
