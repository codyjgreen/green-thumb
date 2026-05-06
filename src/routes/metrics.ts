/**
 * Prometheus-style /metrics endpoint (no auth).
 */

import type { FastifyInstance } from 'fastify';
import { renderMetrics } from '../lib/metrics.js';

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', {
    schema: {
      description: 'Prometheus metrics endpoint',
      tags: ['internal'],
      hide: true,
    },
  }, async (_request, reply) => {
    const getPlantCount = async (): Promise<number> => {
      try {
        return await app.prisma.plantEntry.count();
      } catch {
        return 0;
      }
    };

    const getBookCount = async (): Promise<number> => {
      try {
        return await app.prisma.book.count();
      } catch {
        return 0;
      }
    };

    const getWebhookSubCount = async (): Promise<number> => {
      try {
        return await app.prisma.webhookSubscription.count();
      } catch {
        return 0;
      }
    };

    const output = renderMetrics(getPlantCount, getBookCount, getWebhookSubCount);

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return output;
  });
}
