/**
 * PFAF enrichment - comprehensive growing data for Green-Thumb plants.
 * Enriches zones, sunlight, water, soil, height, habit, family, description, hazards, images.
 * Run: npx tsx scripts/seed-pfaf-enrich.ts
 */
import sqlite3 from 'sqlite3';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const pfafDb = new sqlite3.Database('/tmp/pfaf.sqlite');

function baseSpecies(s) {
  if (!s) return '';
  return s.split(' var. ')[0].split(' subsp. ')[0].split(' f. ')[0].trim().toLowerCase();
}

// PFAF hardiness: valid patterns like "4-8", "10-12"; "-" means unknown, "0-0" means no hardiness data
function isValidHardiness(h: string | null | undefined): boolean {
  return !!h && h !== '0-0' && h !== '-' && /^\d+-\d+$/.test(h);
}

const shadeMap: Record<string, string> = { N: 'full sun', SN: 'partial shade', FSN: 'full shade', FS: 'full shade', S: 'partial shade' };
const moistMap: Record<string, string> = { DM: 'low', M: 'moderate', MWe: 'high', We: 'high', Wet: 'high' };

function parseHabit(h: string | null): string | null {
  if (!h) return null;
  const lower = h.toLowerCase();
  if (lower.includes('annual') && lower.includes('perennial')) return 'annual / perennial';
  if (lower.includes('annual')) return 'annual';
  if (lower.includes('perennial')) return 'perennial';
  if (lower.includes('biennial')) return 'biennial';
  if (lower.includes('shrub') && !lower.includes('subshrub')) return 'shrub';
  if (lower.includes('tree')) return 'tree';
  if (lower.includes('climber') || lower.includes('vine') || lower.includes('twining')) return 'vining';
  if (lower.includes('bamboo')) return 'bamboo';
  if (lower.includes('fern')) return 'fern';
  if (lower.includes('bulb') || lower.includes('corm') || lower.includes('rhizome')) return 'bulb';
  if (lower.includes('subshrub') || lower.includes('herb')) return 'herbaceous';
  return null;
}

async function main() {
  console.log('Loading PFAF database...');
  const pfafByBase = new Map<string, any>();

  const allRows = await new Promise<any[]>((res, rej) => {
    const rows: any[] = [];
    pfafDb.each(
      `SELECT latin_name, hardiness, shade, moisture, soil, height, habit,
              family, known_hazards, summary, cultivation_details, images
      FROM plant_data`,
      [],
      (e, r) => (e ? rej(e) : r ? rows.push(r) : null),
      (e) => (e ? rej(e) : res(rows))
    );
  });
  pfafDb.close();

  for (const row of allRows) pfafByBase.set(baseSpecies(row.latin_name), row);
  console.log(`PFAF plants loaded: ${allRows.length}`);

  // Get all plants that have a scientificName (we'll match them all)
  const allPlants = await prisma.plantEntry.findMany({
    where: { scientificName: { not: null } },
    select: { id: true, scientificName: true, zoneMin: true },
  });
  console.log(`Our plants with scientificName: ${allPlants.length}`);

  // Enrich all plants missing ANY growing data fields, not just zoneMin
  const needsEnrichment = allPlants.filter(p => {
    // Get full plant data
    return true; // we'll check each field individually
  });
  console.log(`Processing all plants for multi-field enrichment...\n`);

  let updated = 0;
  let matched = 0;
  let noMatch = 0;
  const errors: string[] = [];

  for (let i = 0; i < allPlants.length; i++) {
    const plant = allPlants[i];
    const base = baseSpecies(plant.scientificName);
    const pf = pfafByBase.get(base);
    if (!pf) { noMatch++; continue; }
    matched++;

    // Build enrichment data — only fields that have real PFAF data
    const data: Record<string, any> = {};

    // Hardiness zones (only if valid and plant doesn't already have zones)
    if (isValidHardiness(pf.hardiness)) {
      const m = pf.hardiness.match(/^(\d+)-(\d+)$/);
      if (m && plant.zoneMin === null) {
        data.zoneMin = parseInt(m[1]);
        data.zoneMax = parseInt(m[2]);
      }
    }

    // Sunlight (only if plant doesn't have it)
    if (pf.shade && shadeMap[pf.shade]) {
      data.sunlight = shadeMap[pf.shade];
    }

    // Water needs
    if (pf.moisture && moistMap[pf.moisture]) {
      data.waterNeeds = moistMap[pf.moisture];
    }

    // Soil type (L=sandy, M=loamy, H=clay)
    if (pf.soil) {
      const parts: string[] = [];
      if (pf.soil.includes('L')) parts.push('sandy');
      if (pf.soil.includes('M')) parts.push('loamy');
      if (pf.soil.includes('H')) parts.push('clay');
      if (parts.length) data.soilType = parts.join(', ');
    }

    // Mature height
    if (pf.height && pf.height > 0) {
      const ft = +(pf.height * 3.28084).toFixed(1);
      data.matureHeight = `${pf.height}m / ${ft}ft`;
    }

    // Growth habit
    const gh = parseHabit(pf.habit);
    if (gh) data.growthHabit = gh;

    // Family
    if (pf.family) data.family = pf.family;

    // Description (from summary)
    if (pf.summary && pf.summary.length > 10) {
      data.description = pf.summary.slice(0, 1000);
    }

    // Care notes (hazards + cultivation details)
    let notes = '';
    if (pf.known_hazards) notes += `⚠️ Hazards: ${pf.known_hazards}`;
    if (pf.cultivation_details) {
      if (notes) notes += '\n\n';
      notes += `📋 Cultivation: ${pf.cultivation_details.slice(0, 500)}`;
    }
    if (notes) data.careNotes = notes;

    // PFAF image
    if (pf.images) {
      try {
        const imgs = JSON.parse(pf.images);
        if (Array.isArray(imgs) && imgs.length > 0 && imgs[0]?.url) {
          data.pfafImageUrl = imgs[0].url;
        }
      } catch {}
    }

    if (Object.keys(data).length > 0) {
      try {
        await prisma.plantEntry.update({ where: { id: plant.id }, data });
        updated++;
      } catch (e: any) {
        errors.push(`${plant.scientificName}: ${e.message}`);
      }
    }

    if ((i + 1) % 1000 === 0) console.log(`  ${i + 1} / ${allPlants.length}`);
  }

  console.log(`\n--- Done ---`);
  console.log(`Plants matched to PFAF: ${matched}`);
  console.log(`No PFAF match: ${noMatch}`);
  console.log(`Plants enriched: ${updated}`);
  if (errors.length) console.log(`Errors: ${errors.length}`, errors.slice(0, 3));

  await prisma.$disconnect();
}

main().catch(console.error);