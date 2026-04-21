#!/usr/bin/env node
/**
 * Green-Thumb Plant Knowledge Seeder
 *
 * Seeds plant_entries from pre-researched plant data.
 * Optional: use MiniMax to enrich individual plants with extra fields.
 *
 * Usage:
 *   node scripts/seed-plants.ts [--dry-run] [--batch-size=5] [--enrich]
 *
 * Environment:
 *   DATABASE_URL     - PostgreSQL connection string
 *   MINIMAX_API_KEY  - Optional, for enrichment step
 */

import { PrismaClient } from '@prisma/client';
import { PLANT_DATA, type PlantData } from './plant-data.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:4050/greenthumb';
const DRY_RUN = process.argv.includes('--dry-run');
const ENRICH = process.argv.includes('--enrich');
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '***REMOVED***';
const MINIMAX_BASE_URL = 'https://api.minimax.io/v1';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

// ─── MiniMax enrichment ────────────────────────────────────────────────────
async function enrichWithMinimax(data: PlantData): Promise<Partial<PlantData>> {
  const prompt = `Give me growing info for ${data.commonName} (${data.scientificName}). Respond with ONLY valid JSON. Schema:
{"sunlight":"full sun","waterNeeds":"moderate","soilType":"well-draining","soilPh":"6.0-7.0","zoneMin":3,"zoneMax":9,"frostTolerance":"none","plantingDepth":"1 inch","spacing":"12 inches","daysToGermination":7,"daysToMaturity":90,"matureHeight":"3 feet","matureSpread":"2 feet","growthHabit":"bush","perennialYears":null,"companionPlants":["plant1"],"incompatiblePlants":["plant2"],"commonPests":["pest1"],"commonDiseases":["disease1"],"harvestWindow":"July-September","harvestIndicators":"firm and full color","careNotes":"tips here"}
For annual vegetables, perennialYears MUST be null. Return ONLY JSON matching this schema.`;

  const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [
        { role: 'system', content: 'You are a gardening expert. Output ONLY valid JSON matching the exact schema provided.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
    }),
  });

  if (!response.ok) throw new Error(`MiniMax error ${response.status}`);

  const json = await response.json() as { choices: { message: { content: string } }[] };
  let text = json.choices[0]?.message?.content ?? '';

  // Strip code fences
  text = text.replace(/```json?\s*/i, '').replace(/```\s*$/i, '').trim();

  // Extract JSON by finding first '{' and last '}' — ignores any thinking blocks,
  // commentary, or markdown outside the actual JSON object
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    text = text.slice(jsonStart, jsonEnd + 1);
  }

  try {
    return JSON.parse(text) as Partial<PlantData>;
  } catch {
    return {};
  }
}

// ─── Seed function ────────────────────────────────────────────────────────
async function seedPlant(data: PlantData, attemptEnrich = false): Promise<{ id: string } | null> {
  let record = { ...data };

  // Only enrich if requested and we have an API key
  if (attemptEnrich && ENRICH) {
    try {
      const extra = await enrichWithMinimax(data);
      record = { ...record, ...extra };
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`   ⚠️  Enrichment failed for ${data.commonName}: ${err}`);
    }
  }

  // Build the create payload — only include defined fields
  const createData: Parameters<typeof prisma.plantEntry.create>[0]['data'] = {
    commonName: record.commonName,
    scientificName: record.scientificName ?? null,
    variety: record.variety ?? null,
    family: record.family ?? null,
    description: record.description ?? null,
    category: record.category ?? null,
    sunlight: record.sunlight ?? null,
    waterNeeds: record.waterNeeds ?? null,
    soilType: record.soilType ?? null,
    soilPh: record.soilPh ?? null,
    zoneMin: record.zoneMin ?? null,
    zoneMax: record.zoneMax ?? null,
    frostTolerance: record.frostTolerance ?? null,
    plantingDepth: record.plantingDepth ?? null,
    spacing: record.spacing ?? null,
    daysToGermination: record.daysToGermination ?? null,
    daysToMaturity: record.daysToMaturity ?? null,
    matureHeight: record.matureHeight ?? null,
    matureSpread: record.matureSpread ?? null,
    growthHabit: record.growthHabit ?? null,
    perennialYears: record.perennialYears ?? null,
    companionPlants: (record.companionPlants?.length ?? 0) > 0 ? record.companionPlants ?? null : null,
    incompatiblePlants: (record.incompatiblePlants?.length ?? 0) > 0 ? record.incompatiblePlants ?? null : null,
    commonPests: (record.commonPests?.length ?? 0) > 0 ? record.commonPests ?? null : null,
    commonDiseases: (record.commonDiseases?.length ?? 0) > 0 ? record.commonDiseases ?? null : null,
    harvestWindow: record.harvestWindow ?? null,
    harvestIndicators: record.harvestIndicators ?? null,
    careNotes: record.careNotes ?? null,
  };

  return prisma.plantEntry.create({ data: createData });
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 Green-Thumb Plant Seeder`);
  console.log(`   Dry run: ${DRY_RUN}`);
  console.log(`   Enrich with MiniMax: ${ENRICH}`);
  console.log(`   Plants: ${PLANT_DATA.length}`);
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}\n`);

  // Count existing
  const existing = await prisma.plantEntry.count();
  console.log(`   Already in DB: ${existing}`);

  if (DRY_RUN) {
    PLANT_DATA.forEach(p => console.log(`  + ${p.commonName} (${p.category})`));
    return;
  }

  let success = 0;
  let skipped = 0;

  for (const plant of PLANT_DATA) {
    const key = `${plant.scientificName ?? ''}|${plant.commonName}`;
    const duplicate = await prisma.plantEntry.findFirst({
      where: {
        scientificName: plant.scientificName ?? undefined,
        commonName: plant.commonName,
      },
    });

    if (duplicate) {
      console.log(`  ⊘ ${plant.commonName} (already exists)`);
      skipped++;
      continue;
    }

    try {
      const result = await seedPlant(plant);
      if (result) {
        console.log(`  ✅ ${plant.commonName}`);
        success++;
      }
    } catch (err) {
      console.log(`  ❌ ${plant.commonName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Summary
  const total = await prisma.plantEntry.count();
  console.log(`\n✅ Done! Seeded: ${success}, Skipped: ${skipped}, Total: ${total}`);

  const byCategory = await prisma.$queryRaw<{ category: string | null; count: BigInt }[]>`
    SELECT category, COUNT(*) as count FROM plant_entries GROUP BY category ORDER BY count DESC
  `;
  console.log(`\n📊 Plants by category:`);
  byCategory.forEach(r => console.log(`   ${r.category ?? '(none)'}: ${r.count}`));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
