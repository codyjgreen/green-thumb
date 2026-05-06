#!/usr/bin/env tsx
/**
 * Plant Enrichment + Seeding Script (unlimited concurrency)
 * Run as: OLLAMA_MAX_CONCURRENT=200 OLLAMA_QUEUE_MAX=500 npm run seed:enrich
 * Or directly: OLLAMA_MAX_CONCURRENT=200 node --import tsx scripts/enrich-all.ts
 */

import { PrismaClient } from '@prisma/client';
import { ollamaEnqueue } from '../src/lib/ollama-queue.js';
import { loadConfig } from '../src/lib/config.js';
import { PLANT_KNOWLEDGE_BASE, type PlantIdentity } from './plant-knowledge-base.js';

const cfg = loadConfig();
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:4050/greenthumb' } },
});

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://192.168.0.27:11434';
const MODEL = process.env.OLLAMA_CHAT_MODEL ?? cfg.OLLAMA_CHAT_MODEL;

const DEFAULTS: Record<string, Record<string, unknown>> = {
  vegetable: {
    sunlight: 'full sun', waterNeeds: 'consistent', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 3, zoneMax: 10, frostTolerance: 'none', plantingDepth: '1/4-1/2 inch', spacing: '12-24 inches',
    daysToGermination: 7, daysToMaturity: 60, matureHeight: '2-3 feet', matureSpread: '12-18 inches',
    growthHabit: 'bush', perennialYears: null, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'Varies', harvestIndicators: 'Mature size',
    careNotes: 'Prepare soil with compost. Water consistently. Mulch to retain moisture.',
  },
  fruit: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 4, zoneMax: 9, frostTolerance: 'light', plantingDepth: 'Root ball depth', spacing: '8-15 feet',
    daysToGermination: 14, daysToMaturity: 90, matureHeight: '6-10 feet', matureSpread: '6-10 feet',
    growthHabit: 'bush', perennialYears: 15, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'When ripe', harvestIndicators: 'Full color, slight give',
    careNotes: 'Prune annually. Mulch to retain moisture. Protect from late frosts.',
  },
  herb: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 4, zoneMax: 10, frostTolerance: 'light', plantingDepth: '1/4 inch', spacing: '12-18 inches',
    daysToGermination: 10, daysToMaturity: 60, matureHeight: '12-24 inches', matureSpread: '12-18 inches',
    growthHabit: 'bush', perennialYears: null, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'Before flowering', harvestIndicators: 'Full foliage',
    careNotes: 'Harvest before flowering for best flavor. Pinch to encourage bushiness.',
  },
  flower: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 3, zoneMax: 9, frostTolerance: 'light', plantingDepth: '1/4-1/2 inch', spacing: '12-24 inches',
    daysToGermination: 7, daysToMaturity: 75, matureHeight: '18-36 inches', matureSpread: '12-18 inches',
    growthHabit: 'upright', perennialYears: null, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'When in bloom', harvestIndicators: 'Full color',
    careNotes: 'Deadhead to encourage continuous blooming. Mulch to retain moisture.',
  },
  tree: {
    sunlight: 'full sun', waterNeeds: 'consistent', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 3, zoneMax: 9, frostTolerance: 'hardy', plantingDepth: 'Root ball depth', spacing: '15-30 feet',
    daysToGermination: 30, daysToMaturity: 365, matureHeight: '20-50 feet', matureSpread: '20-30 feet',
    growthHabit: 'upright', perennialYears: 50, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'When ripe', harvestIndicators: 'Full size',
    careNotes: 'Stake young trees. Water deeply and infrequently. Good drainage essential.',
  },
  nut: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 4, zoneMax: 9, frostTolerance: 'hardy', plantingDepth: '1-2 inches', spacing: '30-40 feet',
    daysToGermination: 30, daysToMaturity: 365, matureHeight: '20-50 feet', matureSpread: '20-30 feet',
    growthHabit: 'upright', perennialYears: 30, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'When husks split', harvestIndicators: 'Husks crack open',
    careNotes: 'Requires space and patience. Plant at least two for pollination. Good drainage essential.',
  },
  legume: {
    sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0',
    zoneMin: 3, zoneMax: 10, frostTolerance: 'light', plantingDepth: '1-2 inches', spacing: '4-6 inches',
    daysToGermination: 7, daysToMaturity: 75, matureHeight: '2-4 feet', matureSpread: '12-18 inches',
    growthHabit: 'bush', perennialYears: null, companionPlants: [], incompatiblePlants: [],
    commonPests: [], commonDiseases: [], harvestWindow: 'When pods dry', harvestIndicators: 'Dry brown pods',
    careNotes: 'Fixes nitrogen in soil. Inoculate seeds if new to garden. Do not overwater.',
  },
};

const PROMPT_TEMPLATE = (commonName: string, scientificName: string) => `You are a horticulture expert. Respond ONLY with valid JSON for this plant. No markdown, no explanation.

{
  "description": "1-2 sentence description",
  "sunlight": "full sun" | "partial shade" | "shade" | "partial sun",
  "waterNeeds": "low" | "moderate" | "high" | "consistent",
  "soilType": "sandy" | "loamy" | "clay" | "chalky" | "well-draining" | "moist",
  "soilPh": "6.0-7.0" or similar range,
  "zoneMin": 3-10,
  "zoneMax": 4-13,
  "frostTolerance": "none" | "light" | "moderate" | "hardy",
  "plantingDepth": "e.g. '1/4 inch'",
  "spacing": "e.g. '12-18 inches'",
  "daysToGermination": 5-60,
  "daysToMaturity": 30-365,
  "matureHeight": "e.g. '2-3 feet'",
  "matureSpread": "e.g. '12-18 inches'",
  "growthHabit": "bush" | "vine" | "trailing" | "upright" | "rosette" | "climbing" | "clumping",
  "perennialYears": null for annuals, 2+ for perennials,
  "companionPlants": ["plant1", "plant2", "plant3"],
  "incompatiblePlants": ["plant1", "plant2"],
  "commonPests": ["pest1", "pest2"],
  "commonDiseases": ["disease1", "disease2"],
  "harvestWindow": "e.g. 'June-August'",
  "harvestIndicators": "e.g. 'Full color, firm'",
  "careNotes": "2-3 sentence practical growing tip"
}

Plant: ${commonName} (${scientificName})`;

async function queryOllama(commonName: string, scientificName: string): Promise<Record<string, unknown> | null> {
  const prompt = PROMPT_TEMPLATE(commonName, scientificName);
  try {
    const result = await ollamaEnqueue(MODEL, async () => {
      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });
      if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
      return resp.json() as Promise<{ message: { content: string } }>;
    }, 90000);

    let text: string = (result as { message?: { content?: string } }).message?.content ?? '';
    // Strip markdown code fences
    text = text.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
    // Find JSON bounds
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('No JSON found in response');
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed as Record<string, unknown>;
  } catch (err) {
    return null;
  }
}

interface Stats { processed: number; ok: number; defaulted: number; dbOk: number; dbFail: number; }

async function seedPlant(p: PlantIdentity, stats: Stats): Promise<void> {
  stats.processed++;
  const enriched = await queryOllama(p.commonName, p.scientificName);
  if (enriched) stats.ok++;
  else stats.defaulted++;

  const defaults = DEFAULTS[p.category] ?? DEFAULTS.vegetable!;
  const data = {
    commonName: p.commonName,
    scientificName: p.scientificName,
    family: p.family,
    category: p.category,
    description: (enriched?.description as string) ?? null,
    sunlight: (enriched?.sunlight as string) ?? defaults.sunlight,
    waterNeeds: (enriched?.waterNeeds as string) ?? defaults.waterNeeds,
    soilType: (enriched?.soilType as string) ?? defaults.soilType,
    soilPh: (enriched?.soilPh as string) ?? defaults.soilPh,
    zoneMin: (enriched?.zoneMin as number) ?? defaults.zoneMin,
    zoneMax: (enriched?.zoneMax as number) ?? defaults.zoneMax,
    frostTolerance: (enriched?.frostTolerance as string) ?? defaults.frostTolerance,
    plantingDepth: (enriched?.plantingDepth as string) ?? defaults.plantingDepth,
    spacing: (enriched?.spacing as string) ?? defaults.spacing,
    daysToGermination: (enriched?.daysToGermination as number) ?? defaults.daysToGermination,
    daysToMaturity: (enriched?.daysToMaturity as number) ?? defaults.daysToMaturity,
    matureHeight: (enriched?.matureHeight as string) ?? defaults.matureHeight,
    matureSpread: (enriched?.matureSpread as string) ?? defaults.matureSpread,
    growthHabit: (enriched?.growthHabit as string) ?? defaults.growthHabit,
    perennialYears: (enriched?.perennialYears as number | null) ?? defaults.perennialYears,
    companionPlants: (enriched?.companionPlants as string[] | null) ?? defaults.companionPlants,
    incompatiblePlants: (enriched?.incompatiblePlants as string[] | null) ?? defaults.incompatiblePlants,
    commonPests: (enriched?.commonPests as string[] | null) ?? defaults.commonPests,
    commonDiseases: (enriched?.commonDiseases as string[] | null) ?? defaults.commonDiseases,
    harvestWindow: (enriched?.harvestWindow as string) ?? defaults.harvestWindow,
    harvestIndicators: (enriched?.harvestIndicators as string) ?? defaults.harvestIndicators,
    careNotes: (enriched?.careNotes as string) ?? defaults.careNotes,
  };

  try {
    await prisma.plantEntry.upsert({
      where: { scientificName: p.scientificName },
      create: data,
      update: data,
    });
    stats.dbOk++;
  } catch (err) {
    stats.dbFail++;
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    process.stderr.write(`\nDB ERR ${p.commonName}: ${msg}`);
  }
}

function drawBar(current: number, total: number, width = 28): string {
  const pct = current / total;
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  const LIMIT = parseInt(process.env.LIMIT ?? '999999');
  const CAT = process.env.CATEGORY;

  const plants = PLANT_KNOWLEDGE_BASE.filter(p => !CAT || p.category === CAT).slice(0, LIMIT);
  const total = plants.length;

  console.log('\n🌱 Green-Thumb Plant Enrichment + Seeding');
  console.log(`   Ollama: ${OLLAMA_URL} / ${MODEL}`);
  console.log(`   Concurrency: OLLAMA_MAX_CONCURRENT=${cfg.OLLAMA_MAX_CONCURRENT}${cfg.OLLAMA_MAX_CONCURRENT >= 100 ? ' (unlimited)' : ''}`);
  console.log(`   Plants: ${total} (${CAT ?? 'all categories'})`);
  console.log(`   Dry run: ${DRY_RUN}\n`);

  const stats: Stats = { processed: 0, ok: 0, defaulted: 0, dbOk: 0, dbFail: 0 };
  const start = Date.now();

  for (const plant of plants) {
    if (!DRY_RUN) await seedPlant(plant, stats);

    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const bar = drawBar(stats.processed, total);
    const rate = stats.processed > 0 ? ((stats.processed / (Date.now() - start)) * 1000).toFixed(1) : '0';
    process.stdout.write(
      `\r[${bar}] ${String(stats.processed).padStart(4)}/${total} | ok:${stats.ok} def:${stats.defaulted} dbok:${stats.dbOk} dbfail:${stats.dbFail} | ${rate}/s | ${elapsed}s`
    );

    // Quick progress update every 30 seconds via heartbeat-style stdout flush
    if (stats.processed % 50 === 0 && stats.processed > 0) {
      process.stdout.write('\n');
      console.log(`  --> ${stats.processed} done (${((stats.processed/total)*100).toFixed(1)}%), rate: ${rate}/s`);
    }
  }

  console.log('\n\n✅ Done!');
  console.log(`   Total: ${stats.processed} | Ollama OK: ${stats.ok} | Defaults: ${stats.defaulted} | DB OK: ${stats.dbOk} | DB fail: ${stats.dbFail}`);
  console.log(`   Elapsed: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`   Rate: ${(stats.processed / ((Date.now() - start) / 1000)).toFixed(2)} plants/sec`);

  // Category breakdown
  const byCat = await prisma.$queryRaw<{ category: string; count: bigint }[]>`
    SELECT category, COUNT(*)::int as count FROM plant_entries WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC
  `;
  console.log('\n📊 Plants by category:');
  byCat.forEach(r => console.log(`   ${r.category}: ${Number(r.count)}`));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });