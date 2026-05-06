/**
 * PFAF → Green-Thumb data merge script.
 * Uses concurrent Prisma updates for speed.
 * Run: npx tsx scripts/seed-pfaf.ts
 */
import sqlite3 from 'sqlite3';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const pfafDb = new sqlite3.Database('/tmp/pfaf.sqlite');

function baseSpecies(s) {
  if (!s) return '';
  return s.split(' var. ')[0].split(' subsp. ')[0].split(' f. ')[0].trim().toLowerCase();
}

const shadeMap = { N: 'full sun', SN: 'partial shade', FSN: 'full shade', FS: 'full shade', S: 'partial shade' };
const moistMap = { DM: 'low', M: 'moderate', MWe: 'high', We: 'high', Wet: 'high' };

function parseHabit(h) {
  if (!h) return null;
  const lower = h.toLowerCase();
  if (lower.includes('annual') && lower.includes('perennial')) return 'annual / perennial';
  if (lower.includes('annual')) return 'annual';
  if (lower.includes('perennial')) return 'perennial';
  if (lower.includes('biennial')) return 'biennial';
  if (lower.includes('shrub')) return 'shrub';
  if (lower.includes('tree')) return 'tree';
  if (lower.includes('climber') || lower.includes('vine')) return 'vining';
  if (lower.includes('bamboo')) return 'bamboo';
  if (lower.includes('fern')) return 'fern';
  if (lower.includes('bulb') || lower.includes('corm')) return 'bulb';
  return null;
}

async function main() {
  const ourPlants = await prisma.plantEntry.findMany({
    where: { scientificName: { not: null } },
    select: { id: true, scientificName: true },
  });

  const byBase = new Map();
  for (const p of ourPlants) {
    if (p.scientificName) {
      const base = baseSpecies(p.scientificName);
      if (!byBase.has(base)) byBase.set(base, p.id);
    }
  }

  const pfafPlants = await new Promise((res, rej) => {
    pfafDb.all(`
      SELECT latin_name, habit, height, hardiness, soil, shade, moisture,
             family, known_hazards, habitats, range,
             summary, synonyms, cultivation_details, images
      FROM plant_data
    `, [], (err, rows) => err ? rej(err) : res(rows));
  });

  pfafDb.close();
  console.log(`PFAF: ${pfafPlants.length}, Our plants: ${ourPlants.length}`);

  let matched = 0;
  let noMatch = 0;

  const updateMap = new Map(); // id → data

  for (const pf of pfafPlants) {
    const ourId = byBase.get(baseSpecies(pf.latin_name));
    if (!ourId) { noMatch++; continue; }
    matched++;

    const data = {};

    if (pf.hardiness && pf.hardiness !== '0-0') {
      const m = pf.hardiness.match(/^(\d+)-(\d+)$/);
      if (m) {
        data.zoneMin = parseInt(m[1]);
        data.zoneMax = parseInt(m[2]);
      }
    }
    if (pf.shade && shadeMap[pf.shade]) data.sunlight = shadeMap[pf.shade];
    if (pf.moisture && moistMap[pf.moisture]) data.waterNeeds = moistMap[pf.moisture];
    if (pf.soil) {
      const parts = [];
      if (pf.soil.includes('L')) parts.push('sandy');
      if (pf.soil.includes('M')) parts.push('loamy');
      if (pf.soil.includes('H')) parts.push('clay');
      if (parts.length) data.soilType = parts.join(', ');
    }
    if (pf.height && pf.height > 0) {
      const ft = +(pf.height * 3.28084).toFixed(1);
      data.matureHeight = `${pf.height}m / ${ft}ft`;
    }
    const gh = parseHabit(pf.habit);
    if (gh) data.growthHabit = gh;
    if (pf.family) data.family = pf.family;
    if (pf.summary && pf.summary.length > 10) data.description = pf.summary.slice(0, 1000);
    let notes = '';
    if (pf.known_hazards) notes += `⚠️ Hazards: ${pf.known_hazards}`;
    if (pf.cultivation_details) {
      if (notes) notes += '\n\n';
      notes += `📋 Cultivation: ${pf.cultivation_details.slice(0, 500)}`;
    }
    if (notes) data.careNotes = notes;
    if (pf.synonyms) data.synonyms = pf.synonyms;
    if (pf.range) data.range = pf.range;
    if (pf.habitats) data.habitats = pf.habitats;
    if (pf.images) {
      try {
        const imgs = JSON.parse(pf.images);
        if (Array.isArray(imgs) && imgs.length > 0 && imgs[0].url) data.pfafImageUrl = imgs[0].url;
      } catch {}
    }

    if (Object.keys(data).length === 0) continue;
    updateMap.set(ourId, data);
  }

  console.log(`Matched: ${matched}, no match: ${noMatch}`);
  console.log(`Plants to update: ${updateMap.size}\n`);

  let updated = 0;
  let errors = 0;
  const BATCH = 100;
  const entries = [...updateMap.entries()];

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(([id, data]) =>
        prisma.plantEntry.update({ where: { id }, data }).then(() => 'ok').catch(e => ({ id, err: e.message }))
      )
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === 'ok') updated++;
      else errors++;
    }

    const pct = Math.min(100, Math.round(((i + BATCH) / entries.length) * 100));
    console.log(`  ${Math.min(i + BATCH, entries.length)} / ${entries.length} (${pct}%)`);
  }

  console.log(`\n--- Done ---`);
  console.log(`Updated: ${updated}, Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch(console.error);
