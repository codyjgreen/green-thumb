import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http-errors.js';
import { emitEvent, generateSecret } from '../services/webhooks.js';

const AVAILABLE_EVENTS = [
  'plant.created',
  'plant.updated',
  'plant.deleted',
  'book.uploaded',
  'book.deleted',
  'search.query',
] as const;

export async function registerWebhookRoutes(app: FastifyInstance) {
  // GET /webhooks/events — list available event types
  app.get('/webhooks/events', {
    schema: {
      description: 'List all available webhook event types',
      tags: ['webhooks'],
    },
  }, async () => {
    return { events: AVAILABLE_EVENTS };
  });

  // GET /webhooks — list all subscriptions
  app.get('/webhooks', {
    schema: {
      description: 'List all webhook subscriptions',
      tags: ['webhooks'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    const subscriptions = await app.prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { items: subscriptions };
  });

  // POST /webhooks — create a subscription
  app.post('/webhooks', {
    schema: {
      description: 'Create a webhook subscription',
      tags: ['webhooks'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'url', 'events'],
        properties: {
          name: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          active: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      url: z.string().url(),
      events: z.array(z.string()).min(1),
      active: z.boolean().optional().default(true),
    }).parse(request.body);

    const secret = generateSecret();

    const subscription = await app.prisma.webhookSubscription.create({
      data: {
        name: body.name,
        url: body.url,
        secret,
        events: body.events,
        active: body.active,
      },
    });

    return subscription;
  });

  // DELETE /webhooks/:webhookId — delete a subscription
  app.delete('/webhooks/:webhookId', {
    schema: {
      description: 'Delete a webhook subscription',
      tags: ['webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
      response: {
        204: { type: 'null', description: 'Subscription deleted' },
      },
    },
  }, async (request, reply) => {
    const { webhookId } = z.object({ webhookId: z.string() }).parse(request.params);

    const sub = await app.prisma.webhookSubscription.findUnique({ where: { id: webhookId } });
    if (!sub) throw notFound('Webhook subscription not found');

    await app.prisma.webhookSubscription.delete({ where: { id: webhookId } });
    reply.code(204);
    return null;
  });

  // GET /webhooks/:webhookId/test — fire a test event
  app.get('/webhooks/:webhookId/test', {
    schema: {
      description: 'Send a test event to a webhook subscription',
      tags: ['webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
    },
  }, async (request) => {
    const { webhookId } = z.object({ webhookId: z.string() }).parse(request.params);

    const sub = await app.prisma.webhookSubscription.findUnique({ where: { id: webhookId } });
    if (!sub) throw notFound('Webhook subscription not found');

    const testPayload = {
      test: true,
      message: 'This is a test event from Green-Thumb API',
      timestamp: new Date().toISOString(),
    };

    emitEvent(app.prisma, 'webhook.test', testPayload);

    return { delivered: true, webhookId, event: 'webhook.test', payload: testPayload };
  });
}
