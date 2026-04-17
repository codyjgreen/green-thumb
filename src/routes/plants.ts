import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http-errors.js';

// GET /plants — list all extracted plant entries
export async function registerPlantRoutes(app: FastifyInstance) {
  app.get('/plants', {
    schema: {
      description: 'List all structured plant entries extracted from books',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filter by plant name' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
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
                  commonName: { type: 'string' },
                  scientificName: { type: 'string' },
                  variety: { type: 'string' },
                  family: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const { search, limit = 20, offset = 0 } = z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).parse(request.query);

    const where = search
      ? ({
          OR: [
            { commonName: { contains: search, mode: 'insensitive' as Prisma.StringFilter['mode'] } },
            { scientificName: { contains: search, mode: 'insensitive' as Prisma.StringFilter['mode'] } },
          ],
        })
      : undefined;

    const [plants, total] = await Promise.all([
      app.prisma.plantEntry.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { commonName: 'asc' },
      }),
      app.prisma.plantEntry.count({ where }),
    ]);

    return { items: plants, total, limit, offset };
  });

  // GET /plants/:plantId — get a specific plant entry
  app.get('/plants/:plantId', {
    schema: {
      description: 'Get a specific plant entry by ID',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { plantId: { type: 'string' } },
        required: ['plantId'],
      },
    },
  }, async (request) => {
    const { plantId } = z.object({ plantId: z.string() }).parse(request.params);

    const plant = await app.prisma.plantEntry.findUnique({ where: { id: plantId } });
    if (!plant) throw notFound('Plant not found');

    return plant;
  });

  // POST /plants — manually create a plant entry (e.g., from extracted data)
  app.post('/plants', {
    schema: {
      description: 'Create or update a structured plant entry',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['commonName'],
        properties: {
          commonName: { type: 'string' },
          scientificName: { type: 'string' },
          variety: { type: 'string' },
          family: { type: 'string' },
          description: { type: 'string' },
          bookId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = z.object({
      commonName: z.string(),
      scientificName: z.string().optional(),
      variety: z.string().optional(),
      family: z.string().optional(),
      description: z.string().optional(),
      bookId: z.string().optional(),
    }).parse(request.body);

    const plant = await app.prisma.plantEntry.create({
      data: {
        commonName: body.commonName,
        scientificName: body.scientificName,
        variety: body.variety,
        family: body.family,
        description: body.description,
        bookId: body.bookId,
      },
    });

    reply.code(201);
    return plant;
  });
}
