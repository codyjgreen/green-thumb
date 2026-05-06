import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http-errors.js';
import { recordVersion } from '../services/plant-versions.js';
import { parseCsvToPlants, plantsToCsv } from '../lib/csv.js';
import type { PlantImport, PlantExportRow } from '../lib/plant-types.js';

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

    const where: Prisma.PlantEntryWhereInput = { deletedAt: null };
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

    const plant = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
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
    // Note: onRequest: app.authenticate in schema doesn't fire for POST in Fastify v5
    // So we call it inline at handler start
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const userId = (request as any).user?.userId;
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
        currentVersion: 1,
      },
    });

    await recordVersion(app.prisma, plant.id, null, plant, userId);

    reply.code(201);
    return plant;
  });

  // PATCH /plants/:plantId — update a plant entry
  app.patch('/plants/:plantId', {
    schema: {
      description: 'Update a structured plant entry',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { plantId: { type: 'string' } },
        required: ['plantId'],
      },
      body: {
        type: 'object',
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
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { plantId } = z.object({ plantId: z.string() }).parse(request.params);
    const userId = (request as any).user?.userId;
    const body = z.object({
      commonName: z.string().optional(),
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
    }).parse(request.body);

    const existing = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
    if (!existing) throw notFound('Plant not found');

    const plant = await app.prisma.plantEntry.update({
      where: { id: plantId },
      data: {
        ...(body.commonName !== undefined && { commonName: body.commonName }),
        ...(body.scientificName !== undefined && { scientificName: body.scientificName }),
        ...(body.variety !== undefined && { variety: body.variety }),
        ...(body.family !== undefined && { family: body.family }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.sunlight !== undefined && { sunlight: body.sunlight }),
        ...(body.waterNeeds !== undefined && { waterNeeds: body.waterNeeds }),
        ...(body.soilType !== undefined && { soilType: body.soilType }),
        ...(body.soilPh !== undefined && { soilPh: body.soilPh }),
        ...(body.zoneMin !== undefined && { zoneMin: body.zoneMin }),
        ...(body.zoneMax !== undefined && { zoneMax: body.zoneMax }),
        ...(body.frostTolerance !== undefined && { frostTolerance: body.frostTolerance }),
        ...(body.plantingDepth !== undefined && { plantingDepth: body.plantingDepth }),
        ...(body.spacing !== undefined && { spacing: body.spacing }),
        ...(body.daysToGermination !== undefined && { daysToGermination: body.daysToGermination }),
        ...(body.daysToMaturity !== undefined && { daysToMaturity: body.daysToMaturity }),
        ...(body.matureHeight !== undefined && { matureHeight: body.matureHeight }),
        ...(body.matureSpread !== undefined && { matureSpread: body.matureSpread }),
        ...(body.growthHabit !== undefined && { growthHabit: body.growthHabit }),
        ...(body.perennialYears !== undefined && { perennialYears: body.perennialYears }),
        ...(body.companionPlants !== undefined && { companionPlants: body.companionPlants }),
        ...(body.incompatiblePlants !== undefined && { incompatiblePlants: body.incompatiblePlants }),
        ...(body.commonPests !== undefined && { commonPests: body.commonPests }),
        ...(body.commonDiseases !== undefined && { commonDiseases: body.commonDiseases }),
        ...(body.harvestWindow !== undefined && { harvestWindow: body.harvestWindow }),
        ...(body.harvestIndicators !== undefined && { harvestIndicators: body.harvestIndicators }),
        ...(body.careNotes !== undefined && { careNotes: body.careNotes }),
        currentVersion: (existing.currentVersion ?? 1) + 1,
      },
    });

    await recordVersion(app.prisma, plant.id, existing, plant, userId);

    return plant;
  });

  // DELETE /plants/:plantId — delete a plant entry
  app.delete('/plants/:plantId', {
    onRequest: app.authenticate,
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

    const plant = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
    if (!plant) throw notFound('Plant not found');

    // Soft delete — marks as deleted without removing data
    await app.prisma.plantEntry.update({
      where: { id: plantId },
      data: { deletedAt: new Date() },
    });
    reply.code(204);
    return null;
  });

  // GET /plants/:plantId/versions — get version history for a plant
  app.get('/plants/:plantId/versions', {
    schema: {
      description: 'Get version history for a plant entry (newest first)',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { plantId: { type: 'string' } },
        required: ['plantId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            versions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  version: { type: 'number' },
                  changes: { type: 'object' },
                  changedBy: { type: 'string', nullable: true },
                  changedAt: { type: 'string' },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const { plantId } = z.object({ plantId: z.string() }).parse(request.params);

    const plant = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
    if (!plant) throw notFound('Plant not found');

    const [versions, total] = await Promise.all([
      app.prisma.plantVersion.findMany({
        where: { plantId },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          changes: true,
          changedBy: true,
          changedAt: true,
        },
      }),
      app.prisma.plantVersion.count({ where: { plantId } }),
    ]);

    return { versions, total };
  });

  // GET /plants/:plantId/versions/:version — get a specific version's full data
  app.get('/plants/:plantId/versions/:version', {
    schema: {
      description: 'Get a specific version\'s full plant data (reconstruct plant at that version)',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          plantId: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['plantId', 'version'],
      },
    },
  }, async (request) => {
    const { plantId, version: versionStr } = z.object({
      plantId: z.string(),
      version: z.string(),
    }).parse(request.params);

    const versionNum = parseInt(versionStr, 10);
    if (isNaN(versionNum)) throw notFound('Invalid version number');

    const plantVersion = await app.prisma.plantVersion.findUnique({
      where: { plantId_version: { plantId, version: versionNum } },
    });
    if (!plantVersion) throw notFound('Plant version not found');

    // Reconstruct the plant at this version by applying changes in order
    const allVersions = await app.prisma.plantVersion.findMany({
      where: { plantId },
      orderBy: { version: 'asc' },
    });

    // Start with an empty plant and apply each version's changes
    const basePlant: Record<string, unknown> = {};
    for (const v of allVersions) {
      if (v.version > versionNum) break;
      const changes = v.changes as Record<string, [unknown, unknown]>;
      for (const [field, [, newVal]] of Object.entries(changes)) {
        if (field === '__created') continue;
        basePlant[field] = newVal;
      }
    }

    // Get the current plant to fill in any unchanged fields
    const currentPlant = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
    if (!currentPlant) throw notFound('Plant not found');

    return { ...currentPlant, ...basePlant, currentVersion: versionNum };
  });

  // POST /plants/:plantId/versions/:version/restore — restore a plant to a previous version
  app.post('/plants/:plantId/versions/:version/restore', {
    schema: {
      description: 'Restore a plant to a previous version\'s data (creates a new version)',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          plantId: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['plantId', 'version'],
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { plantId, version: versionStr } = z.object({
      plantId: z.string(),
      version: z.string(),
    }).parse(request.params);

    const userId = (request as any).user?.userId;
    const versionNum = parseInt(versionStr, 10);
    if (isNaN(versionNum)) throw notFound('Invalid version number');

    const plantVersion = await app.prisma.plantVersion.findUnique({
      where: { plantId_version: { plantId, version: versionNum } },
    });
    if (!plantVersion) throw notFound('Plant version not found');

    // Get all versions up to and including the target version
    const allVersions = await app.prisma.plantVersion.findMany({
      where: { plantId, version: { lte: versionNum } },
      orderBy: { version: 'asc' },
    });

    // Reconstruct the plant at this version
    const reconstructed: Record<string, unknown> = {};
    for (const v of allVersions) {
      const changes = v.changes as Record<string, [unknown, unknown]>;
      for (const [field, [, newVal]] of Object.entries(changes)) {
        if (field === '__created') continue;
        reconstructed[field] = newVal;
      }
    }

    const existing = await app.prisma.plantEntry.findUnique({ where: { id: plantId, deletedAt: null } });
    if (!existing) throw notFound('Plant not found');

    const plant = await app.prisma.plantEntry.update({
      where: { id: plantId },
      data: {
        ...reconstructed,
        currentVersion: (existing.currentVersion ?? 1) + 1,
      },
    });

    await recordVersion(app.prisma, plant.id, existing, plant, userId);

    return plant;
  });

  // POST /plants/import — bulk import plants from CSV or JSON
  app.post('/plants/import', {
    schema: {
      description: 'Bulk import plants from CSV or JSON',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            imported: { type: 'number' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  row: { type: 'number' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request as Parameters<typeof app.authenticate>[0], reply as Parameters<typeof app.authenticate>[1]);

    const contentType = (request.headers['content-type'] ?? '') as string;
    let plants: PlantImport[] = [];
    const parseErrors: { row: number; message: string }[] = [];

    if (contentType.includes('multipart/form-data')) {
      const data = await request.file();
      if (!data) throw Object.assign(new Error('No file uploaded'), { statusCode: 400 });
      const content = Buffer.from(await data.toBuffer()).toString('utf-8');
      const filename = data.filename.toLowerCase();
      if (filename.endsWith('.csv')) {
        const result = parseCsvToPlants(content);
        plants = result.plants;
        result.errors.forEach((msg) => parseErrors.push({ row: 0, message: msg }));
      } else if (filename.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          plants = Array.isArray(parsed) ? parsed : (parsed.plants ?? []);
        } catch {
          throw Object.assign(new Error('Invalid JSON file'), { statusCode: 400 });
        }
      } else {
        throw Object.assign(new Error('Unsupported file type. Use .csv or .json'), { statusCode: 400 });
      }
    } else if (contentType.includes('application/json')) {
      const body = request.body as Record<string, unknown>;
      const format = (body.format as string) ?? 'json';
      if (format === 'csv') {
        const csvContent = typeof body.csv === 'string' ? body.csv : JSON.stringify(body.csv ?? '');
        if (!csvContent) throw Object.assign(new Error('CSV content required when format=csv'), { statusCode: 400 });
        const result = parseCsvToPlants(csvContent);
        plants = result.plants;
        result.errors.forEach((msg) => parseErrors.push({ row: 0, message: msg }));
      } else {
        const rawPlants = body.plants;
        if (!Array.isArray(rawPlants)) throw Object.assign(new Error('plants must be an array'), { statusCode: 400 });
        plants = rawPlants as PlantImport[];
      }
    } else {
      throw Object.assign(new Error('Content-Type must be multipart/form-data or application/json'), { statusCode: 400 });
    }

    const importErrors = [...parseErrors];
    let imported = 0;

    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      try {
        await app.prisma.plantEntry.create({
          data: {
            commonName: p.commonName,
            scientificName: p.scientificName ?? null,
            variety: p.variety ?? null,
            family: p.family ?? null,
            description: p.description ?? null,
            category: p.category ?? null,
            sunlight: p.sunlight ?? null,
            waterNeeds: p.waterNeeds ?? null,
            soilType: p.soilType ?? null,
            soilPh: p.soilPh ?? null,
            zoneMin: p.zoneMin ?? null,
            zoneMax: p.zoneMax ?? null,
            frostTolerance: p.frostTolerance ?? null,
            plantingDepth: p.plantingDepth ?? null,
            spacing: p.spacing ?? null,
            daysToGermination: p.daysToGermination ?? null,
            daysToMaturity: p.daysToMaturity ?? null,
            matureHeight: p.matureHeight ?? null,
            matureSpread: p.matureSpread ?? null,
            growthHabit: p.growthHabit ?? null,
            perennialYears: p.perennialYears ?? null,
            companionPlants: p.companionPlants ?? null,
            incompatiblePlants: p.incompatiblePlants ?? null,
            commonPests: p.commonPests ?? null,
            commonDiseases: p.commonDiseases ?? null,
            harvestWindow: p.harvestWindow ?? null,
            harvestIndicators: p.harvestIndicators ?? null,
            careNotes: p.careNotes ?? null,
          },
        });
        imported++;
      } catch (err) {
        importErrors.push({
          row: i + 1,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { imported, errors: importErrors };
  });

  // GET /plants/export — bulk export plants as JSON or CSV
  app.get('/plants/export', {
    schema: {
      description: 'Bulk export plants as JSON or CSV',
      tags: ['plants'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          category: { type: 'string' },
          search: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request as Parameters<typeof app.authenticate>[0], reply as Parameters<typeof app.authenticate>[1]);

    const { format = 'json', category, search } = z.object({
      format: z.enum(['json', 'csv']).default('json'),
      category: z.string().optional(),
      search: z.string().optional(),
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

    const plants = await app.prisma.plantEntry.findMany({
      where,
      orderBy: { commonName: 'asc' },
    });

    const today = new Date().toISOString().split('T')[0];
    const filename = `plants-export-${today}.${format}`;

    if (format === 'csv') {
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      const rows: PlantExportRow[] = plants.map((p) => ({
        commonName: p.commonName,
        scientificName: p.scientificName,
        variety: p.variety,
        family: p.family,
        category: p.category,
        sunlight: p.sunlight,
        waterNeeds: p.waterNeeds,
        soilType: p.soilType,
        soilPh: p.soilPh,
        zoneMin: p.zoneMin,
        zoneMax: p.zoneMax,
        frostTolerance: p.frostTolerance,
        plantingDepth: p.plantingDepth,
        spacing: p.spacing,
        daysToGermination: p.daysToGermination,
        daysToMaturity: p.daysToMaturity,
        matureHeight: p.matureHeight,
        matureSpread: p.matureSpread,
        growthHabit: p.growthHabit,
        perennialYears: p.perennialYears,
        companionPlants: (p.companionPlants as string[] | null) ?? null,
        incompatiblePlants: (p.incompatiblePlants as string[] | null) ?? null,
        commonPests: (p.commonPests as string[] | null) ?? null,
        commonDiseases: (p.commonDiseases as string[] | null) ?? null,
        harvestWindow: p.harvestWindow,
        harvestIndicators: p.harvestIndicators,
        description: p.description,
        careNotes: p.careNotes,
      }));
      return plantsToCsv(rows);
    }

    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return plants;
  });
}
