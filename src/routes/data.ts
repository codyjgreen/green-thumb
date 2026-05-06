import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { badRequest } from '../lib/http-errors.js';
import { fetchArticleText } from '../services/web.js';
import { recordVersion } from '../services/plant-versions.js';

const upsertPlantSchema = z.object({
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
});

export async function registerDataRoutes(app: FastifyInstance) {
  // GET /data/sources — list available data source types
  app.get('/data/sources', {
    schema: {
      description: 'List available external data source types for plant import',
      tags: ['data'],
      response: {
        200: {
          type: 'object',
          properties: {
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  type: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    return {
      sources: [
        {
          id: 'usda',
          name: 'USDA Plants Database',
          description: 'Comprehensive US plant database covering native and introduced species. Available as bulk CSV download.',
          type: 'csv',
        },
        {
          id: 'rhs',
          name: 'Royal Horticultural Society',
          description: 'UK horticultural plant database. Requires manual data export from RHS website (CSV).',
          type: 'csv',
        },
        {
          id: 'web',
          name: 'Web URL Import',
          description: 'Import any plant from a web article URL (Wikipedia, seed bank, gardening blog, etc.) via POST /data/plants/from-url',
          type: 'api',
        },
      ],
    };
  });

  // POST /data/plants/from-url — fetch a URL and create a plant entry
  // Rate limited: 10 imports per hour per IP to prevent abuse of the SSRF-friendly endpoint
  app.post('/data/plants/from-url', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour',
      },
    },
    schema: {
      description: 'Fetch a plant article from a URL and create a plant entry from the content',
      tags: ['data'],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          commonName: { type: 'string', description: 'Override the plant common name (defaults to page title)' },
        },
      },
    },
  }, async (request, reply) => {
    const { url, commonName } = z.object({
      url: z.string().url(),
      commonName: z.string().optional(),
    }).parse(request.body);

    const jobId = randomUUID();

    // Start background URL fetch and plant creation
    (async () => {
      try {
        const article = await fetchArticleText(url);
        const name = commonName ?? article.title ?? 'Unknown Plant';

        // Try to extract scientific name from content (heuristic: first italicized/parens term)
        const scientificMatch = article.content.match(/\(([A-Z][a-z]+ [a-z]+)\)/);
        const scientificName = scientificMatch ? scientificMatch[1] : undefined;

        const plant = await app.prisma.plantEntry.create({
          data: {
            commonName: name,
            scientificName: scientificName ?? null,
            description: article.content.slice(0, 2000),
            careNotes: `Imported from: ${url}`,
            currentVersion: 1,
          },
        });

        console.log(`[data] Plant created from URL: ${plant.id} (${plant.commonName})`);
      } catch (err: any) {
        console.error(`[data] URL import failed for ${url}:`, err.message);
      }
    })();

    reply.code(202);
    return {
      jobId,
      status: 'processing',
      message: 'URL fetch started in background. Poll GET /jobs/:jobId for status.',
    };
  });

  // POST /data/plants/import-from-permapeople
  // Search Permapeople and import plant(s) into Green-Thumb DB
  app.post('/data/plants/import-from-permapeople', {
    schema: {
      description: 'Search Permapeople and import matching plants into Green-Thumb',
      tags: ['data'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Plant name to search for on Permapeople' },
          limit: { type: 'integer', default: 5, description: 'Max plants to import (default 5)' },
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { query, limit = 5 } = z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().default(5),
    }).parse(request.body);

    const config = app.config;
    const keyId = config.PERMAPEOPLE_KEY_ID;
    const keySecret = config.PERMAPEOPLE_KEY_SECRET;

    if (!keyId || !keySecret) {
      return reply.status(503).send({ error: 'Permapeople API credentials not configured' });
    }

    // Search Permapeople
    const searchRes = await fetch('https://permapeople.org/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-permapeople-key-id': keyId,
        'x-permapeople-key-secret': keySecret,
      },
      body: JSON.stringify({ q: query }),
    });

    if (!searchRes.ok) {
      return reply.status(502).send({ error: `Permapeople search failed: ${searchRes.status}` });
    }

    const { plants: searchResults } = await searchRes.json() as { plants: any[] };
    const toImport = searchResults.slice(0, limit);

    const imported: string[] = [];
    const errors: string[] = [];

    for (const permaplant of toImport) {
      try {
        // Fetch full plant details
        const detailRes = await fetch(`https://permapeople.org/api/plants/${permaplant.id}`, {
          headers: {
            'x-permapeople-key-id': keyId,
            'x-permapeople-key-secret': keySecret,
          },
        });
        if (!detailRes.ok) continue;
        const plant = await detailRes.json() as any;

        // Parse key-value data into a map
        const data: Record<string, string> = {};
        for (const item of plant.data ?? []) {
          data[item.key] = item.value;
        }

        // Parse USDA zone range (e.g. "3-12" → 3, 12)
        let zoneMin: number | null = null;
        let zoneMax: number | null = null;
        const zoneMatch = (data['USDA Hardiness zone'] ?? '').match(/(\d+)-(\d+)/);
        if (zoneMatch) {
          zoneMin = parseInt(zoneMatch[1]);
          zoneMax = parseInt(zoneMatch[2]);
        }

        // Map life cycle: Annual → perennialYears=1, Perennial → null (perennial)
        const lifeCycle = data['Life cycle'] ?? '';
        const perennialYears = lifeCycle.toLowerCase() === 'annual' ? 1 : null;

        // Parse height in meters (value is just a number like "0.3")
        const heightStr = data['Height'] ?? '';
        const heightMeters = parseFloat(heightStr);
        const matureHeight = !isNaN(heightMeters) && heightMeters > 0 ? `${heightMeters}m` : null;

        // Width
        const widthStr = data['Width'] ?? '';
        const widthMeters = parseFloat(widthStr);
        const matureSpread = !isNaN(widthMeters) && widthMeters > 0 ? `${widthMeters}m` : null;

        // Parse germination time (e.g. "14-21 days")
        const germMatch = (data['Germination time'] ?? '').match(/(\d+)-?(\d+)?\s*days?/i);
        const daysToGermination = germMatch ? parseInt(germMatch[2] ?? germMatch[1]) : null;

        // Layer → category
        const layerMap: Record<string, string> = {
          'Trees': 'tree', 'Shrubs': 'shrub', 'Herbs': 'herb',
          'Vines': 'vine', 'Ground cover': 'ground cover',
        };
        const category = layerMap[data['Layer'] ?? ''] ?? data['Layer'] ?? null;

        // Water needs normalization
        const waterMap: Record<string, string> = {
          'Dry': 'low', 'Moist': 'moderate', 'Wet': 'high',
        };
        const waterNeeds = waterMap[data['Water requirement'] ?? ''] ?? null;

        // Sunlight normalization
        const lightMap: Record<string, string> = {
          'Full sun': 'full sun', 'Partial sun/shade': 'partial shade',
          'Full shade': 'shade',
        };
        const sunlight = lightMap[data['Light requirement'] ?? ''] ?? null;

        // Upsert into Green-Thumb (by scientificName or commonName)
        const whereClause = plant.scientific_name
          ? { scientificName: plant.scientific_name }
          : { commonName: plant.name };

        const existing = await app.prisma.plantEntry.findFirst({ where: whereClause });

        const plantData = {
          commonName: plant.name,
          scientificName: plant.scientific_name ?? null,
          family: data['Family'] ?? null,
          description: plant.description ?? null,
          category,
          sunlight,
          waterNeeds,
          soilType: data['Soil type'] ?? null,
          soilPh: data['Soil pH'] ?? null,
          zoneMin,
          zoneMax,
          matureHeight,
          matureSpread,
          perennialYears,
          spacing: data['Spacing'] ?? null,
          daysToGermination,
          growthHabit: data['Growth'] ?? null,
          careNotes: `Imported from Permapeople (CC BY-SA 4.0). Wikipedia: ${data['Wikipedia'] ?? 'N/A'}`,
          currentVersion: existing ? undefined : 1,
        };

        if (existing) {
          await app.prisma.plantEntry.update({
            where: { id: existing.id },
            data: plantData,
          });
        } else {
          await app.prisma.plantEntry.create({ data: plantData as any });
        }

        imported.push(`${plant.name} (${plant.scientific_name ?? 'no sci name'})`);
      } catch (err: any) {
        errors.push(`${permaplant.name}: ${err.message}`);
      }
    }

    return {
      imported,
      errors: errors.length ? errors : undefined,
      totalImported: imported.length,
      source: 'permapeople.org (CC BY-SA 4.0)',
    };
  });

  // POST /data/plants/upsert — upsert a single plant entry manually
  app.post('/data/plants/upsert', {
    schema: {
      description: 'Insert or update a single plant entry (upsert by scientificName or commonName)',
      tags: ['data'],
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
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const userId = (request as any).user?.userId;
    const body = upsertPlantSchema.parse(request.body);

    // Look up by scientificName+variety if both provided, otherwise by scientificName alone,
    // otherwise by commonName. This avoids accidentally matching a different variety
    // of the same species (e.g. two Ficus carica entries — 'Brown Turkey' vs 'Celeste').
    const lookupWhere = body.scientificName
      ? { scientificName: body.scientificName, variety: body.variety ?? null }
      : { commonName: body.commonName };

    let existing = await app.prisma.plantEntry.findFirst({ where: lookupWhere });

    // If variety was provided but no match found, fall back to scientificName-only lookup
    // (for plants that have variety=null in the database).
    if (!existing && body.scientificName && body.variety) {
      existing = await app.prisma.plantEntry.findFirst({
        where: { scientificName: body.scientificName, variety: null },
      });
    }

    if (existing) {
      const updated = await app.prisma.plantEntry.update({
        where: { id: existing.id },
        data: {
          commonName: body.commonName,
          scientificName: body.scientificName ?? existing.scientificName,
          variety: body.variety ?? existing.variety,
          family: body.family ?? existing.family,
          description: body.description ?? existing.description,
          category: body.category ?? existing.category,
          sunlight: body.sunlight ?? existing.sunlight,
          waterNeeds: body.waterNeeds ?? existing.waterNeeds,
          soilType: body.soilType ?? existing.soilType,
          soilPh: body.soilPh ?? existing.soilPh,
          zoneMin: body.zoneMin ?? existing.zoneMin,
          zoneMax: body.zoneMax ?? existing.zoneMax,
          frostTolerance: body.frostTolerance ?? existing.frostTolerance,
          plantingDepth: body.plantingDepth ?? existing.plantingDepth,
          spacing: body.spacing ?? existing.spacing,
          daysToGermination: body.daysToGermination ?? existing.daysToGermination,
          daysToMaturity: body.daysToMaturity ?? existing.daysToMaturity,
          matureHeight: body.matureHeight ?? existing.matureHeight,
          matureSpread: body.matureSpread ?? existing.matureSpread,
          growthHabit: body.growthHabit ?? existing.growthHabit,
          perennialYears: body.perennialYears ?? existing.perennialYears,
          companionPlants: body.companionPlants ?? existing.companionPlants,
          incompatiblePlants: body.incompatiblePlants ?? existing.incompatiblePlants,
          commonPests: body.commonPests ?? existing.commonPests,
          commonDiseases: body.commonDiseases ?? existing.commonDiseases,
          harvestWindow: body.harvestWindow ?? existing.harvestWindow,
          harvestIndicators: body.harvestIndicators ?? existing.harvestIndicators,
          careNotes: body.careNotes ?? existing.careNotes,
          currentVersion: (existing.currentVersion ?? 1) + 1,
        },
      });
      await recordVersion(app.prisma, updated.id, existing, updated, userId);
      return { plant: updated, action: 'updated' };
    }

    const plant = await app.prisma.plantEntry.create({
      data: {
        commonName: body.commonName,
        scientificName: body.scientificName ?? null,
        variety: body.variety ?? null,
        family: body.family ?? null,
        description: body.description ?? null,
        category: body.category ?? null,
        sunlight: body.sunlight ?? null,
        waterNeeds: body.waterNeeds ?? null,
        soilType: body.soilType ?? null,
        soilPh: body.soilPh ?? null,
        zoneMin: body.zoneMin ?? null,
        zoneMax: body.zoneMax ?? null,
        frostTolerance: body.frostTolerance ?? null,
        plantingDepth: body.plantingDepth ?? null,
        spacing: body.spacing ?? null,
        daysToGermination: body.daysToGermination ?? null,
        daysToMaturity: body.daysToMaturity ?? null,
        matureHeight: body.matureHeight ?? null,
        matureSpread: body.matureSpread ?? null,
        growthHabit: body.growthHabit ?? null,
        perennialYears: body.perennialYears ?? null,
        companionPlants: body.companionPlants ?? null,
        incompatiblePlants: body.incompatiblePlants ?? null,
        commonPests: body.commonPests ?? null,
        commonDiseases: body.commonDiseases ?? null,
        harvestWindow: body.harvestWindow ?? null,
        harvestIndicators: body.harvestIndicators ?? null,
        careNotes: body.careNotes ?? null,
        currentVersion: 1,
      },
    });
    await recordVersion(app.prisma, plant.id, null, plant, userId);

    reply.code(201);
    return { plant, action: 'created' };
  });
}
