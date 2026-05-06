#!/usr/bin/env tsx
/**
 * Plant Enrichment with Progress Tracking - skips already-enriched plants
 */
import { PrismaClient } from '@prisma/client';
import { ollamaEnqueue } from '../src/lib/ollama-queue.js';
import { loadConfig } from '../src/lib/config.js';
import { PLANT_KNOWLEDGE_BASE } from './plant-knowledge-base.js';

const cfg = loadConfig();
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:4050/greenthumb' } },
});

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://192.168.0.27:11434';
const MODEL = process.env.OLLAMA_CHAT_MODEL ?? cfg.OLLAMA_CHAT_MODEL;
const LIMIT = parseInt(process.env.LIMIT ?? '999999');
const CAT = process.env.CATEGORY;
const START_IDX = parseInt(process.env.START_IDX ?? '0');

const DEFAULTS: Record<string, Record<string, unknown>> = {
  vegetable: { sunlight: 'full sun', waterNeeds: 'consistent', soilType: 'well-draining', soilPh: '6.0-7.0', zoneMin: 3, zoneMax: 10, frostTolerance: 'none', plantingDepth: '1/4-1/2 inch', spacing: '12-24 inches', daysToGermination: 7, daysToMaturity: 60, matureHeight: '2-3 feet', matureSpread: '12-18 inches', growthHabit: 'bush', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Varies', harvestIndicators: 'Mature size', careNotes: 'Prepare soil with compost. Water consistently. Mulch to retain moisture.' },
  fruit: { sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0', zoneMin: 5, zoneMax: 10, frostTolerance: 'moderate', plantingDepth: '1/2-1 inch', spacing: '6-12 feet', daysToGermination: 14, daysToMaturity: 120, matureHeight: '6-15 feet', matureSpread: '6-10 feet', growthHabit: 'tree', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Peak summer', harvestIndicators: 'Color change', careNotes: 'Prune annually. Monitor for pests.' },
  herb: { sunlight: 'full sun to partial shade', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.5', zoneMin: 3, zoneMax: 9, frostTolerance: 'moderate', plantingDepth: '1/8-1/4 inch', spacing: '12-18 inches', daysToGermination: 10, daysToMaturity: 60, matureHeight: '1-3 feet', matureSpread: '12-24 inches', growthHabit: 'herb', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Before flowering', harvestIndicators: 'Mature foliage', careNotes: 'Harvest regularly to encourage growth.' },
  flower: { sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.0', zoneMin: 4, zoneMax: 9, frostTolerance: 'moderate', plantingDepth: '1/4-1/2 inch', spacing: '6-12 inches', daysToGermination: 7, daysToMaturity: 90, matureHeight: '1-4 feet', matureSpread: '6-18 inches', growthHabit: 'herb', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Bloom season', harvestIndicators: 'Open blooms', careNotes: 'Deadhead to prolong blooming.' },
  tree: { sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.5', zoneMin: 3, zoneMax: 9, frostTolerance: 'moderate', plantingDepth: '1-2 inches', spacing: '20-40 feet', daysToGermination: 30, daysToMaturity: 365, matureHeight: '30-60 feet', matureSpread: '20-40 feet', growthHabit: 'tree', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Mature', harvestIndicators: 'Full size', careNotes: 'Requires patience - trees take years to mature.' },
  nut: { sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.5', zoneMin: 4, zoneMax: 9, frostTolerance: 'moderate', plantingDepth: '1-2 inches', spacing: '30-50 feet', daysToGermination: 30, daysToMaturity: 730, matureHeight: '30-80 feet', matureSpread: '30-50 feet', growthHabit: 'tree', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Nut fall', harvestIndicators: 'Nuts fall', careNotes: 'Requires significant space. Long-term investment.' },
  legume: { sunlight: 'full sun', waterNeeds: 'moderate', soilType: 'well-draining', soilPh: '6.0-7.5', zoneMin: 3, zoneMax: 10, frostTolerance: 'none', plantingDepth: '1-2 inches', spacing: '4-6 inches', daysToGermination: 7, daysToMaturity: 60, matureHeight: '2-6 feet', matureSpread: '4-6 inches', growthHabit: 'vine', perennialYears: null, companionPlants: [], incompatiblePlants: [], commonPests: [], commonDiseases: [], harvestWindow: 'Pods dry', harvestIndicators: 'Dry pods', careNotes: 'Fixes nitrogen. inoculate seed for best results.' },
};

const SYSTEM = 'You are Green-Thumb, an expert botanical database. For the plant described, respond ONLY with a valid JSON object using this exact structure: {"sunlight":"string","waterNeeds":"string","soilType":"string","soilPh":"string","zoneMin":"number","zoneMax":"number","frostTolerance":"string","plantingDepth":"string","spacing":"string","daysToGermination":"number","daysToMaturity":"number","matureHeight":"string","matureSpread":"string","growthHabit":"string","perennialYears":"number|null","companionPlants":"string[]","incompatiblePlants":"string[]","commonPests":"string[]","commonDiseases":"string[]","harvestWindow":"string","harvestIndicators":"string","careNotes":"string"}. No markdown, no explanation, just the JSON.';

let existingNames: Set<string> | null = null;

async function getExistingNames(): Promise<Set<string>> {
  if (existingNames) return existingNames;
  const rows = await prisma.$queryRaw<{ scientificName: string }[]>`
    SELECT "scientificName" FROM plant_entries WHERE "scientificName" IS NOT NULL
  `;
  existingNames = new Set(rows.map(r => r.scientificName));
  console.log(`Already enriched: ${existingNames.size} plants`);
  return existingNames;
}

async function seedPlant(p: typeof PLANT_KNOWLEDGE_BASE[0]) {
  const defaults = DEFAULTS[p.category] ?? DEFAULTS.vegetable;
  
  const enriched = await ollamaEnqueue(MODEL, async () => {
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Enrich: ${p.commonName} (${p.scientificName})` }], stream: false }),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const raw = await resp.text();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('No JSON found');
    const json = JSON.parse(raw.slice(start, end + 1));
    return json;
  }).catch(err => {
    process.stderr.write(`\nOllama ERR ${p.commonName}: ${String(err).split('\n')[0]}\n`);
    return null;
  });

  if (!enriched) return false;

  const data = {
    commonName: p.commonName,
    scientificName: p.scientificName,
    family: p.family,
    category: p.category,
    sunlight: enriched.sunlight ?? defaults.sunlight,
    waterNeeds: enriched.waterNeeds ?? defaults.waterNeeds,
    soilType: enriched.soilType ?? defaults.soilType,
    soilPh: enriched.soilPh ?? defaults.soilPh,
    zoneMin: Number(enriched.zoneMin ?? defaults.zoneMin),
    zoneMax: Number(enriched.zoneMax ?? defaults.zoneMax),
    frostTolerance: enriched.frostTolerance ?? defaults.frostTolerance,
    plantingDepth: enriched.plantingDepth ?? defaults.plantingDepth,
    spacing: enriched.spacing ?? defaults.spacing,
    daysToGermination: Number(enriched.daysToGermination ?? defaults.daysToGermination),
    daysToMaturity: Number(enriched.daysToMaturity ?? defaults.daysToMaturity),
    matureHeight: enriched.matureHeight ?? defaults.matureHeight,
    matureSpread: enriched.matureSpread ?? defaults.matureSpread,
    growthHabit: enriched.growthHabit ?? defaults.growthHabit,
    perennialYears: enriched.perennialYears ?? defaults.perennialYears,
    companionPlants: Array.isArray(enriched.companionPlants) ? enriched.companionPlants : [],
    incompatiblePlants: Array.isArray(enriched.incompatiblePlants) ? enriched.incompatiblePlants : [],
    commonPests: Array.isArray(enriched.commonPests) ? enriched.commonPests : [],
    commonDiseases: Array.isArray(enriched.commonDiseases) ? enriched.commonDiseases : [],
    harvestWindow: enriched.harvestWindow ?? defaults.harvestWindow,
    harvestIndicators: enriched.harvestIndicators ?? defaults.harvestIndicators,
    careNotes: enriched.careNotes ?? defaults.careNotes,
  };

  try {
    await prisma.plantEntry.upsert({
      where: { scientificName: p.scientificName },
      create: data,
      update: data,
    });
    return true;
  } catch (err) {
    process.stderr.write(`\nDB ERR ${p.commonName}: ${String(err).split('\n')[0]}\n`);
    return false;
  }
}

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  
  // Load existing names once at startup
  if (!DRY_RUN) {
    await getExistingNames();
  }
  
  const plants = PLANT_KNOWLEDGE_BASE.filter(p => !CAT || p.category === CAT).slice(START_IDX, START_IDX + LIMIT);
  const total = plants.length;
  const startTime = Date.now();
  let ok = 0, def = 0, dbOk = 0, dbFail = 0;

  console.log(`\n🌱 Enrichment (progress tracking)`);
  console.log(`   Ollama: ${OLLAMA_URL} / ${MODEL}`);
  console.log(`   Concurrency: ${cfg.OLLAMA_MAX_CONCURRENT}`);
  console.log(`   Plants: ${total} (offset ${START_IDX})`);
  console.log(`   Dry run: ${DRY_RUN}\n`);

  for (let i = 0; i < plants.length; i++) {
    const p = plants[i];
    
    // Skip already-enriched
    if (!DRY_RUN && existingNames && existingNames.has(p.scientificName)) {
      process.stdout.write(`\r[SKIP ${String(i+1).padStart(4)}/${total}] ${p.commonName} (already enriched)`);
      continue;
    }
    
    if (!DRY_RUN) {
      const success = await seedPlant(p);
      if (success) { ok++; dbOk++; } else { def++; }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = ok > 0 ? ((ok / (Date.now() - startTime)) * 1000).toFixed(2) : '0.00';
    const pct = ((i + 1) / total * 100).toFixed(1);
    process.stdout.write(`\r[${pct}%] ${String(i+1).padStart(4)}/${total} | ok:${ok} def:${def} dbok:${dbOk} dbfail:${dbFail} | ${rate}/s | ${elapsed}s   `);
  }
  
  console.log(`\n\n✅ Done! Added: ${dbOk} | Failed: ${dbFail} | Skipped: ${existingNames?.size ?? 0}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
