import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { searchAndFetchPlantData } from '../services/web.js';

const REQUIRED_FIELDS: Array<'sunlight' | 'waterNeeds' | 'soilType' | 'daysToMaturity' | 'matureHeight'> = [
  'sunlight', 'waterNeeds', 'soilType', 'daysToMaturity', 'matureHeight',
];

function isRichEntry(plant: Record<string, unknown>): boolean {
  if (!plant.description) return false;
  const filled = REQUIRED_FIELDS.filter(f => plant[f] != null);
  return filled.length >= 3;
}

// GET /search/enrich?plant=<name>
// Checks PlantEntry DB first. Falls back to web search if data is missing.
export async function registerEnrichRoutes(app: FastifyInstance) {
  app.get('/search/enrich', {
    schema: {
      description: 'Enrich plant data by checking the DB first, then falling back to a web search. Web results are saved to the DB for future use.',
      tags: ['plants', 'search'],
      querystring: {
        type: 'object',
        required: ['plant'],
        properties: {
          plant: { type: 'string', minLength: 1, description: 'Plant common name or scientific name to look up' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '"db" or "web"' },
            sourceUrl: { type: 'string' },
            plant: { type: 'object', additionalProperties: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { plant: plantName } = z.object({
      plant: z.string().min(1),
    }).parse(request.query);

    // Fuzzy search in DB by commonName or scientificName
    const dbMatch = await app.prisma.plantEntry.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { commonName: { contains: plantName, mode: 'insensitive' } },
          { scientificName: { contains: plantName, mode: 'insensitive' } },
        ],
      },
    });

    if (dbMatch && isRichEntry(dbMatch as unknown as Record<string, unknown>)) {
      return reply.send({ source: 'db', plant: dbMatch });
    }

    // Fall back to web search
    const enrichment = await searchAndFetchPlantData(plantName);
    if (!enrichment) {
      return reply.status(404).send({ error: `No data found for plant: ${plantName}` });
    }

    // Upsert into DB — use existing record if we found one with weak data
    let saved;
    if (dbMatch) {
      saved = await app.prisma.plantEntry.update({
        where: { id: dbMatch.id },
        data: {
          scientificName: enrichment.scientificName ?? dbMatch.scientificName,
          description: enrichment.description ?? dbMatch.description,
          sunlight: enrichment.sunlight ?? dbMatch.sunlight,
          waterNeeds: enrichment.waterNeeds ?? dbMatch.waterNeeds,
          soilType: enrichment.soilType ?? dbMatch.soilType,
          soilPh: enrichment.soilPh ?? dbMatch.soilPh,
          category: enrichment.category ?? dbMatch.category,
          zoneMin: enrichment.zoneMin ?? dbMatch.zoneMin,
          zoneMax: enrichment.zoneMax ?? dbMatch.zoneMax,
          frostTolerance: enrichment.frostTolerance ?? dbMatch.frostTolerance,
          daysToMaturity: enrichment.daysToMaturity ?? dbMatch.daysToMaturity,
          matureHeight: enrichment.matureHeight ?? dbMatch.matureHeight,
          growthHabit: enrichment.growthHabit ?? dbMatch.growthHabit,
          commonPests: enrichment.commonPests ?? dbMatch.commonPests ?? undefined,
          commonDiseases: enrichment.commonDiseases ?? dbMatch.commonDiseases ?? undefined,
          careNotes: enrichment.careNotes ?? dbMatch.careNotes,
        },
      });
    } else {
      saved = await app.prisma.plantEntry.create({
        data: {
          commonName: enrichment.commonName,
          scientificName: enrichment.scientificName,
          description: enrichment.description,
          sunlight: enrichment.sunlight,
          waterNeeds: enrichment.waterNeeds,
          soilType: enrichment.soilType,
          soilPh: enrichment.soilPh,
          category: enrichment.category,
          zoneMin: enrichment.zoneMin,
          zoneMax: enrichment.zoneMax,
          frostTolerance: enrichment.frostTolerance,
          daysToMaturity: enrichment.daysToMaturity,
          matureHeight: enrichment.matureHeight,
          growthHabit: enrichment.growthHabit,
          commonPests: enrichment.commonPests ?? undefined,
          commonDiseases: enrichment.commonDiseases ?? undefined,
          careNotes: enrichment.careNotes,
        },
      });
    }

    return reply.send({ source: 'web', sourceUrl: enrichment.sourceUrl ?? undefined, plant: saved });
  });
}
