/**
 * Request timing middleware plugin.
 *
 * Adds:
 * - `X-Response-Time-ms` header — time from request start to response finish
 * - `X-Request-Id` header — unique request ID (from request.requestId or generated)
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function timingPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    // Use requestId set by error-handler plugin if already present, otherwise generate
    if (!request.requestId) {
      request.requestId = randomUUID();
    }
    request.startTime = process.hrtime.bigint();
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    // Add timing headers
    reply.header('X-Request-Id', request.requestId);

    if (request.startTime) {
      const elapsed = Number(process.hrtime.bigint() - request.startTime) / 1_000_000;
      reply.header('X-Response-Time-ms', elapsed.toFixed(2));
    }
  });
}
