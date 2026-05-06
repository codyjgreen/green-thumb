import type { FastifyInstance } from 'fastify';
import { isRedisHealthy } from '../lib/redis.js';
import { getOllamaQueueStatus } from '../lib/ollama-queue.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            database: { type: 'string' },
            redis: { type: 'string' },
            ollama: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                queueDepth: { type: 'number' },
                maxConcurrent: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async () => {
    let dbStatus = 'unknown';
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    const redisHealthy = await isRedisHealthy();
    const redisStatus = redisHealthy ? 'connected' : 'disconnected';

    const queueStatuses = getOllamaQueueStatus();
    const totalDepth = queueStatuses.reduce((sum, q) => sum + q.queueDepth, 0);
    const maxConcurrent = queueStatuses[0]?.maxConcurrent ?? 2;

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      redis: redisStatus,
      ollama: {
        status: 'ok',
        queueDepth: totalDepth,
        maxConcurrent,
      },
    };
  });
}
