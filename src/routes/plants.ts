import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http-errors.js';

// GET /plants — list all structured plant entries
export async function registerPlantRoutes(app: FastifyInstance) {
  app.get('/plants', {
    schema: {
      description: 'List all structured plant entries with optional filtering',
      tags: ['plants'],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search by common or scientific name' },
          category: { type: 'string', description: 'Filter by category: vegetable, fruit, herb, flower, tree, nut, legume' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: { type: 'array' },
            total: { type: 'number' },
            limit: { type: 'number' },
            offset: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const { search, category, limit = 20, offset = 0 } = z.object({
      search: z.string().optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).parse(request.query);

    const where: Prisma.PlantEntryWhereInput = {};
    if (search) {
      where.OR = [
        { commonName: { contains: search, mode: 'insensitive' } },
        { scientificName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (category) {
      where.category = category;
    }

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
      body: {
        type: 'object',
        required: ['commonName'],
        properties: {
          commonName: { type: 'string' },
          scientificName: { type: 'string' },
          variety: { type: 'string' },
          family: { type: 'string' },
          description: { type: 'string' },
          category: { type: 'string' },
          sunlight: { type: 'string' },
          waterNeeds: { type: 'string' },
          soilType: { type: 'string' },
          soilPh: { type: 'string' },
          zoneMin: { type: 'integer' },
          zoneMax: { type: 'integer' },
          frostTolerance: { type: 'string' },
          plantingDepth: { type: 'string' },
          spacing: { type: 'string' },
          daysToGermination: { type: 'integer' },
          daysToMaturity: { type: 'integer' },
          matureHeight: { type: 'string' },
          matureSpread: { type: 'string' },
          growthHabit: { type: 'string' },
          perennialYears: { type: 'integer' },
          companionPlants: { type: 'array', items: { type: 'string' } },
          incompatiblePlants: { type: 'array', items: { type: 'string' } },
          commonPests: { type: 'array', items: { type: 'string' } },
          commonDiseases: { type: 'array', items: { type: 'string' } },
          harvestWindow: { type: 'string' },
          harvestIndicators: { type: 'string' },
          careNotes: { type: 'string' },
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
      category: z.string().optional(),
      sunlight: z.string().optional(),
      waterNeeds: z.string().optional(),
      soilType: z.string().optional(),
      soilPh: z.string().optional(),
      zoneMin: z.number().int().optional(),
      zoneMax: z.number().int().optional(),
      frostTolerance: z.string().optional(),
      plantingDepth: z.string().optional(),
      spacing: z.string().optional(),
      daysToGermination: z.number().int().optional(),
      daysToMaturity: z.number().int().optional(),
      matureHeight: z.string().optional(),
      matureSpread: z.string().optional(),
      growthHabit: z.string().optional(),
      perennialYears: z.number().int().optional(),
      companionPlants: z.array(z.string()).optional(),
      incompatiblePlants: z.array(z.string()).optional(),
      commonPests: z.array(z.string()).optional(),
      commonDiseases: z.array(z.string()).optional(),
      harvestWindow: z.string().optional(),
      harvestIndicators: z.string().optional(),
      careNotes: z.string().optional(),
      bookId: z.string().optional(),
    }).parse(request.body);

    const plant = await app.prisma.plantEntry.create({
      data: {
        commonName: body.commonName,
        scientificName: body.scientificName,
        variety: body.variety,
        family: body.family,
        description: body.description,
        category: body.category,
        sunlight: body.sunlight,
        waterNeeds: body.waterNeeds,
        soilType: body.soilType,
        soilPh: body.soilPh,
        zoneMin: body.zoneMin,
        zoneMax: body.zoneMax,
        frostTolerance: body.frostTolerance,
        plantingDepth: body.plantingDepth,
        spacing: body.spacing,
        daysToGermination: body.daysToGermination,
        daysToMaturity: body.daysToMaturity,
        matureHeight: body.matureHeight,
        matureSpread: body.matureSpread,
        growthHabit: body.growthHabit,
        perennialYears: body.perennialYears,
        companionPlants: body.companionPlants ?? null,
        incompatiblePlants: body.incompatiblePlants ?? null,
        commonPests: body.commonPests ?? null,
        commonDiseases: body.commonDiseases ?? null,
        harvestWindow: body.harvestWindow,
        harvestIndicators: body.harvestIndicators,
        careNotes: body.careNotes,
        bookId: body.bookId,
      },
    });

    reply.code(201);
    return plant;
  });

  // DELETE /plants/:plantId — delete a plant entry
  app.delete('/plants/:plantId', {
    schema: {
      description: 'Delete a plant entry by ID',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { plantId: { type: 'string' } },
        required: ['plantId'],
      },
      response: {
        204: { type: 'null', description: 'Plant deleted successfully' },
      },
    },
  }, async (request, reply) => {
    const { plantId } = z.object({ plantId: z.string() }).parse(request.params);

    const plant = await app.prisma.plantEntry.findUnique({ where: { id: plantId } });
    if (!plant) throw notFound('Plant not found');

    await app.prisma.plantEntry.delete({ where: { id: plantId } });
    reply.code(204);
    return null;
  });
}
