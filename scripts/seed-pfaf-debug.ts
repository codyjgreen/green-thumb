/**
 * Debug: check PFAF matching coverage
 * Run: npx tsx scripts/seed-pfaf-debug.ts
 */
import sqlite3 from 'sqlite3';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const pfafDb = new sqlite3.Database('/tmp/pfaf.sqlite');

function baseSpecies(s) {
  if (!s) return '';
  return s.split(' var. ')[0].split(' subsp. ')[0].split(' f. ')[0].trim().toLowerCase();
}

// Our plants missing zones
const needsZones = await prisma.plantEntry.findMany({
  where: { zoneMin: null, scientificName: { not: null } },
  select: { id: true, scientificName: true },
});
console.log(`Our plants missing zones: ${needsZones.length}`);

// Build PFAF index by base species
const pfafByBase = new Map();
const allRows = await new Promise((res, rej) => {
  const rows = [];
  pfafDb.each(
    `SELECT latin_name, hardiness, shade, moisture, soil, height, habit,
            family, known_hazards, summary, cultivation_details, images
    FROM plant_data`,
    [],
    (e, r) => (e ? rej(e) : r ? rows.push(r) : null),
    (e) => (e ? rej(e) : res(rows))
  });
});
pfafDb.close();

for (const pf of allRows) pfafByBase.set(baseSpecies(pf.latin_name), pf);
console.log(`PFAF entries: ${allRows.length}`);

// Stats
let matched = 0;
let hasHardiness = 0;
for (const p of needsZones) {
  const pf = pfafByBase.get(baseSpecies(p.scientificName));
  if (pf) {
    matched++;
    if (pf.hardiness && pf.hardiness !== '0-0') hasHardiness++;
  }
}
console.log(`Missing zones + matched to PFAF: ${matched}`);
console.log(`Matched with real hardiness: ${hasHardiness}`);

// Total our plants with PFAF match
const allOurPlants = await prisma.plantEntry.findMany({
  where: { scientificName: { not: null } },
  select: { scientificName: true },
});
let totalMatched = 0;
for (const p of allOurPlants) {
  if (pfafByBase.get(baseSpecies(p.scientificName))) totalMatched++;
}
console.log(`Our total matched to PFAF: ${totalMatched} / ${allOurPlants.length}`);

await prisma.$disconnect();
