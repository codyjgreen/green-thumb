import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';

export default function errorHandlerPlugin(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = request.requestId ?? randomUUID();
  const statusCode = error.statusCode || 500;

  // Log at error level with requestId and stack trace
  request.log.error({
    requestId,
    error: error.message,
    stack: error.stack,
    statusCode,
  });

  if (error.name === 'ZodError') {
    return reply.code(400).send({ statusCode: 400, message: 'Validation error', error: error.message });
  }

  if (error.statusCode === 400 || error.validation) {
    return reply.code(400).send({ statusCode: 400, message: error.message, requestId });
  }

  if (error.message === 'Ollama queue full') {
    return reply.code(503).send({
      statusCode: 503,
      message: 'Service busy — Ollama queue full, try again shortly',
      requestId,
    });
  }

  if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' || error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
    return reply.code(401).send({ statusCode: 401, message: 'Invalid or missing authorization token', requestId });
  }

  // Don't expose internal error details to client
  const safeMessage = statusCode >= 500 ? 'Internal server error' : error.message;

  return reply.code(statusCode).send({
    statusCode,
    message: safeMessage,
    error: error.name || 'Error',
    requestId,
  });
}
