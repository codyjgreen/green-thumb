import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http-errors.js';

// GET /tasks — list all gardening tasks extracted from books
export async function registerTaskRoutes(app: FastifyInstance) {
  app.get('/tasks', {
    schema: {
      description: 'List gardening tasks and tips extracted from books',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['task', 'tip'],
            description: 'Filter by task type',
          },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  contentType: { type: 'string' },
                  sourceChunkId: { type: 'string' },
                  sourceBook: {
                    type: 'object',
                    properties: { id: { type: 'string' }, title: { type: 'string' } },
                  },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const { type, limit = 20, offset = 0 } = z.object({
      type: z.enum(['task', 'tip']).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }).parse(request.query);

    const contentTypes = type === 'task' ? ['task'] : type === 'tip' ? ['tip'] : ['task', 'tip'];

    const chunks = await app.prisma.bookChunk.findMany({
      where: { contentType: { in: contentTypes } },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        chapter: true,
        section: true,
        contentText: true,
        contentType: true,
        book: { select: { id: true, title: true } },
      },
    });

    const total = await app.prisma.bookChunk.count({
      where: { contentType: { in: contentTypes } },
    });

    return {
      items: chunks.map(c => ({
        id: c.id,
        title: c.chapter ?? c.contentText.slice(0, 80),
        description: c.contentText,
        contentType: c.contentType,
        sourceChunkId: c.id,
        sourceBook: c.book,
      })),
      total,
    };
  });

  // GET /tasks/:taskId — get a specific task
  app.get('/tasks/:taskId', {
    schema: {
      description: 'Get a specific task by chunk ID',
      tags: ['tasks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
    },
  }, async (request) => {
    const { taskId } = z.object({ taskId: z.string() }).parse(request.params);

    const chunk = await app.prisma.bookChunk.findUnique({
      where: { id: taskId },
      include: { book: { select: { id: true, title: true } } },
    });

    if (!chunk) throw notFound('Task not found');

    return {
      id: chunk.id,
      title: chunk.chapter ?? chunk.contentText.slice(0, 80),
      description: chunk.contentText,
      contentType: chunk.contentType,
      chapter: chunk.chapter,
      section: chunk.section,
      pageNumber: chunk.pageNumber,
      sourceBook: chunk.book,
    };
  });
}
