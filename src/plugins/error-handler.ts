import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export default function errorHandlerPlugin(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
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
