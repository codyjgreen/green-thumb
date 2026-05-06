#!/usr/bin/env tsx
/**
 * Plant Enrichment + Seeding Script
 *
 * Loads plant identity data from plant-knowledge-base.ts,
 * enriches each with Ollama-generated growing data,
 * upserts into the Green-Thumb plant_entries table.
 *
 * Usage:
 *   npm run seed:enrich                              # all plants
 *   npm run seed:enrich -- --dry-run                # show without writing
 *   npm run seed:enrich -- --limit 20               # first 20 plants
 *   npm run seed:enrich -- --batch-size 5           # 5 at a time
 *   npm run seed:enrich -- --category vegetable     # only vegetables
 */

import { PrismaClient } from '@prisma/client';
import { ollamaEnqueue } from '../src/lib/ollama-queue.js';
import { PLANT_DATA, type PlantData } from './plant-data.js';

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseArg(args, '--limit', Infinity);
const BATCH_SIZE = parseArg(args, '--batch-size', Infinity);
const CATEGORY = parseArgStr(args, '--category');

function parseArg(argv: string[], key: string, fallback: number): number {
  const idx = argv.indexOf(key);
  if (idx === -1) return fallback;
  return parseInt(argv[idx + 1] ?? String(fallback), 10);
}

function parseArgStr(argv: string[], key: string): string | undefined {
  const idx = argv.indexOf(key);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

// ─── Ollama config ───────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? 'llama3.2:3b';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:4050/greenthumb';

// ─── Category defaults ───────────────────────────────────────────────────────

const CATEGORY_DEFAULTS: Record<string, Partial<PlantData>> = {
  vegetable: {
    sunlight: 'full sun', waterNeeds: 'consistent', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 3, zoneMax: 10, frostTolerance: 'none',
    plantingDepth: '1/4-1/2 inch', spacing: '12-24 inches',
    daysToGermination: 7, daysToMaturity: 60, growthHabit: 'bush',
    perennialYears: null, harvestWindow: 'Varies', harvestIndicators: 'Mature size',
    careNotes: 'Prepare soil with compost. Water consistently. Harvest at maturity.',
  },
  fruit: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 4, zoneMax: 9, frostTolerance: 'light',
    plantingDepth: 'Depth of root ball', spacing: '8-15 feet',
    daysToGermination: 14, daysToMaturity: 90, growthHabit: 'bush',
    perennialYears: 15, harvestWindow: 'When ripe', harvestIndicators: 'Full color, slight give',
    careNotes: 'Prune annually. Mulch to retain moisture. Protect from late frosts.',
  },
  herb: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 4, zoneMax: 10, frostTolerance: 'light',
    plantingDepth: '1/4 inch', spacing: '12-18 inches',
    daysToGermination: 10, daysToMaturity: 60, growthHabit: 'bush',
    perennialYears: null, harvestWindow: 'Before flowering', harvestIndicators: 'Full foliage',
    careNotes: 'Harvest before flowering for best flavor. Pinch to encourage bushiness.',
  },
  flower: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 3, zoneMax: 9, frostTolerance: 'light',
    plantingDepth: '1/4-1/2 inch', spacing: '12-24 inches',
    daysToGermination: 7, daysToMaturity: 75, growthHabit: 'upright',
    perennialYears: null, harvestWindow: 'When in bloom', harvestIndicators: 'Full color',
    careNotes: 'Deadhead to encourage continuous blooming. Mulch to retain moisture.',
  },
  tree: {
    sunlight: 'full sun', waterNeeds: 'consistent', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 3, zoneMax: 9, frostTolerance: 'hardy',
    plantingDepth: 'Depth of root ball', spacing: '15-30 feet',
    daysToGermination: 30, daysToMaturity: 365, growthHabit: 'upright',
    perennialYears: 50, harvestWindow: 'When ripe', harvestIndicators: 'Full size, proper color',
    careNotes: 'Stake young trees. Water deeply and infrequently. Prune to shape.',
  },
  nut: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 4, zoneMax: 9, frostTolerance: 'hardy',
    plantingDepth: '1-2 inches', spacing: '30-40 feet',
    daysToGermination: 30, daysToMaturity: 365, growthHabit: 'upright',
    perennialYears: 30, harvestWindow: 'When husks split', harvestIndicators: 'Husks crack open',
    careNotes: 'Requires space and patience. Plant at least two for pollination. Good drainage essential.',
  },
  legume: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining',
    soilPh: '6.0-7.0', zoneMin: 3, zoneMax: 10, frostTolerance: 'light',
    plantingDepth: '1-2 inches', spacing: '4-6 inches',
    daysToGermination: 7, daysToMaturity: 75, growthHabit: 'bush',
    perennialYears: null, harvestWindow: 'When pods are dry', harvestIndicators: 'Dry, brown pods',
    careNotes: 'Fixes nitrogen in soil. Inoculate seeds if new to garden. Do not overwater.',
  },
};

// ─── Ollama enrichment ──────────────────────────────────────────────────────

const ENRICHMENT_PROMPT = (commonName: string, scientificName: string): string => `You are a horticulture expert. Respond ONLY with valid JSON for this plant. No markdown, no explanation.

{
  "description": "1-2 sentence description",
  "sunlight": "full sun" | "partial shade" | "shade" | "partial sun",
  "waterNeeds": "low" | "moderate" | "high" | "consistent",
  "soilType": "sandy" | "loamy" | "clay" | "chalky" | "well-draining" | "moist",
  "soilPh": "6.0-7.0" or similar range,
  "zoneMin": USDA min zone (3-10),
  "zoneMax": USDA max zone (4-13),
  "frostTolerance": "none" | "light" | "moderate" | "hardy",
  "plantingDepth": "e.g. '1/4 inch', '1 inch', '2-3 feet deep'",
  "spacing": "e.g. '12-18 inches', '3-4 feet'",
  "daysToGermination": 5-60,
  "daysToMaturity": 30-365,
  "matureHeight": "e.g. '6-12 inches', '2-3 feet', '6-8 feet'",
  "matureSpread": "e.g. '12-18 inches', '3-4 feet'",
  "growthHabit": "bush" | "vine" | "trailing" | "upright" | "rosette" | "climbing" | "clumping",
  "perennialYears": null for annuals, 2+ for perennials,
  "companionPlants": ["plant1", "plant2", "plant3"],
  "incompatiblePlants": ["plant1", "plant2"],
  "commonPests": ["pest1", "pest2"],
  "commonDiseases": ["disease1", "disease2"],
  "harvestWindow": "e.g. 'June-August', 'When foliage dies back'",
  "harvestIndicators": "e.g. 'Firm, full color', 'Skin cracks at base'",
  "careNotes": "2-3 sentence practical growing tips"
}

Plant: ${commonName} (${scientificName})`;

interface EnrichmentResult {
  description?: string;
  sunlight?: string;
  waterNeeds?: string;
  soilType?: string;
  soilPh?: string;
  zoneMin?: number;
  zoneMax?: number;
  frostTolerance?: string;
  plantingDepth?: string;
  spacing?: string;
  daysToGermination?: number;
  daysToMaturity?: number;
  matureHeight?: string;
  matureSpread?: string;
  growthHabit?: string;
  perennialYears?: number | null;
  companionPlants?: string[];
  incompatiblePlants?: string[];
  commonPests?: string[];
  commonDiseases?: string[];
  harvestWindow?: string;
  harvestIndicators?: string;
  careNotes?: string;
}

async function enrichPlant(plant: PlantData): Promise<EnrichmentResult> {
  const response = await ollamaEnqueue(
    OLLAMA_CHAT_MODEL,
    async () => {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_CHAT_MODEL,
          messages: [
            {
              role: 'user',
              content: ENRICHMENT_PROMPT(plant.commonName, plant.scientificName),
            },
          ],
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text}`);
      }

      const json = await res.json() as { message?: { content?: string } };
      return json.message?.content ?? '';
    },
  );

  let text = (response as string) ?? '';

  // Strip markdown code fences
  text = text.replace(/```json?\s*/i, '').replace(/```\s*$/i, '').trim();

  // Find JSON bounds: first '{' to last '}'
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error('No JSON object found in response');
  }

  const jsonText = text.slice(jsonStart, jsonEnd + 1);
  const parsed = JSON.parse(jsonText) as EnrichmentResult;

  // Validate required fields
  const required = ['description', 'sunlight', 'waterNeeds', 'soilType', 'daysToMaturity', 'growthHabit'];
  for (const field of required) {
    if (parsed[field as keyof EnrichmentResult] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return parsed;
}

// ─── Prisma ───────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

async function upsertPlant(plant: PlantData, enriched: Partial<PlantData>): Promise<void> {
  await prisma.plantEntry.upsert({
    where: { scientificName: plant.scientificName },
    create: {
      commonName: plant.commonName,
      scientificName: plant.scientificName,
      variety: plant.variety ?? null,
      family: plant.family ?? null,
      description: enriched.description ?? plant.description ?? null,
      category: plant.category,
      sunlight: enriched.sunlight ?? null,
      waterNeeds: enriched.waterNeeds ?? null,
      soilType: enriched.soilType ?? null,
      soilPh: enriched.soilPh ?? null,
      zoneMin: enriched.zoneMin ?? null,
      zoneMax: enriched.zoneMax ?? null,
      frostTolerance: enriched.frostTolerance ?? null,
      plantingDepth: enriched.plantingDepth ?? null,
      spacing: enriched.spacing ?? null,
      daysToGermination: enriched.daysToGermination ?? null,
      daysToMaturity: enriched.daysToMaturity ?? null,
      matureHeight: enriched.matureHeight ?? null,
      matureSpread: enriched.matureSpread ?? null,
      growthHabit: enriched.growthHabit ?? null,
      perennialYears: enriched.perennialYears ?? null,
      companionPlants: (enriched.companionPlants?.length ?? 0) > 0 ? enriched.companionPlants : null,
      incompatiblePlants: (enriched.incompatiblePlants?.length ?? 0) > 0 ? enriched.incompatiblePlants : null,
      commonPests: (enriched.commonPests?.length ?? 0) > 0 ? enriched.commonPests : null,
      commonDiseases: (enriched.commonDiseases?.length ?? 0) > 0 ? enriched.commonDiseases : null,
      harvestWindow: enriched.harvestWindow ?? null,
      harvestIndicators: enriched.harvestIndicators ?? null,
      careNotes: enriched.careNotes ?? null,
    },
    update: {
      description: enriched.description ?? plant.description ?? null,
      sunlight: enriched.sunlight ?? null,
      waterNeeds: enriched.waterNeeds ?? null,
      soilType: enriched.soilType ?? null,
      soilPh: enriched.soilPh ?? null,
      zoneMin: enriched.zoneMin ?? null,
      zoneMax: enriched.zoneMax ?? null,
      frostTolerance: enriched.frostTolerance ?? null,
      plantingDepth: enriched.plantingDepth ?? null,
      spacing: enriched.spacing ?? null,
      daysToGermination: enriched.daysToGermination ?? null,
      daysToMaturity: enriched.daysToMaturity ?? null,
      matureHeight: enriched.matureHeight ?? null,
      matureSpread: enriched.matureSpread ?? null,
      growthHabit: enriched.growthHabit ?? null,
      perennialYears: enriched.perennialYears ?? null,
      companionPlants: (enriched.companionPlants?.length ?? 0) > 0 ? enriched.companionPlants : null,
      incompatiblePlants: (enriched.incompatiblePlants?.length ?? 0) > 0 ? enriched.incompatiblePlants : null,
      commonPests: (enriched.commonPests?.length ?? 0) > 0 ? enriched.commonPests : null,
      commonDiseases: (enriched.commonDiseases?.length ?? 0) > 0 ? enriched.commonDiseases : null,
      harvestWindow: enriched.harvestWindow ?? null,
      harvestIndicators: enriched.harvestIndicators ?? null,
      careNotes: enriched.careNotes ?? null,
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Green-Thumb Plant Enrichment + Seeding');
  console.log(`  Dry run:       ${DRY_RUN}`);
  console.log(`  Limit:         ${LIMIT === Infinity ? 'all' : LIMIT}`);
  console.log(`  Batch size:    ${BATCH_SIZE === Infinity ? 'all' : BATCH_SIZE}`);
  console.log(`  Category:      ${CATEGORY ?? 'all'}`);
  console.log(`  Ollama:        ${OLLAMA_BASE_URL} / ${OLLAMA_CHAT_MODEL}`);
  console.log(`  Database:      ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  console.log('');

  // Filter plants
  let plants = PLANT_DATA;
  if (CATEGORY) {
    plants = plants.filter(p => p.category === CATEGORY);
    if (plants.length === 0) {
      console.error(`No plants found for category: ${CATEGORY}`);
      console.error(`Valid categories: ${Object.keys(CATEGORY_DEFAULTS).join(', ')}`);
      process.exit(1);
    }
  }
  plants = plants.slice(0, LIMIT);
  const total = plants.length;
  console.log(`Processing ${total} plants...\n`);

  // Stats
  let enriched = 0;
  let defaulted = 0;
  const byCategory: Record<string, { ok: number; defaulted: number }> = {};

  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];
    const cat = plant.category;
    if (!byCategory[cat]) byCategory[cat] = { ok: 0, defaulted: 0 };

    const n = i + 1;
    let result: 'OK' | 'DEFAULT' = 'OK';
    let enrichedData: Partial<PlantData> = {};

    try {
      enrichedData = await enrichPlant(plant);
      enriched++;
      byCategory[cat].ok++;
    } catch (err) {
      // Fall back to category defaults
      const defaults = CATEGORY_DEFAULTS[plant.category] ?? CATEGORY_DEFAULTS['vegetable']!;
      enrichedData = { ...defaults };
      result = 'DEFAULT';
      defaulted++;
      byCategory[cat].defaulted++;
      console.warn(`  ⚠️  Ollama failed for ${plant.commonName}: ${err instanceof Error ? err.message : String(err)} — using ${cat} defaults`);
    }

    console.log(`  Enriched [${n}/${total}]: ${plant.commonName} - ${result}`);

    if (!DRY_RUN) {
      try {
        await upsertPlant(plant, enrichedData as Partial<PlantData>);
      } catch (err) {
        console.error(`  ❌ DB write failed for ${plant.commonName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────────
  const finalCount = await prisma.plantEntry.count();

  console.log('\n📊 Summary');
  console.log(`   Total processed:  ${total}`);
  console.log(`   Enriched (Ollama): ${enriched}`);
  console.log(`   Defaulted:         ${defaulted}`);
  console.log(`   Total in DB:       ${finalCount}`);

  console.log('\n📋 By category:');
  console.log(`   Category         OK   Default  Total`);
  console.log(`   ─────────────────────────────────────`);
  for (const [cat, stats] of Object.entries(byCategory)) {
    const totalCat = stats.ok + stats.defaulted;
    console.log(`   ${cat.padEnd(15)} ${String(stats.ok).padStart(3)}  ${String(stats.defaulted).padStart(3)}     ${totalCat}`);
  }

  console.log('\n🔧 Ollama status:');
  console.log(`   Model:       ${OLLAMA_CHAT_MODEL}`);
  console.log(`   Base URL:   ${OLLAMA_BASE_URL}`);
  console.log(`   Status:     ${enriched > 0 ? 'responding' : 'no successful calls'}`);

  console.log(DRY_RUN ? '\n✅ Dry run complete — no DB writes.' : '\n✅ Seeding complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());