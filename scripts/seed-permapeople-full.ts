/**
 * Full batch import of ALL plants from Permapeople into Green-Thumb DB.
 * - Iterates all ~9,000 plants via cursor pagination (last_id)
 * - Fetches full plant details (not just search results)
 * - Stores growing conditions, taxonomy, AND image URLs
 * - Resumable: tracks last_id in a temp file so it can be re-run safely
 * - Upsert: updates existing records, inserts new ones
 *
 * Run: npx tsx scripts/seed-permapeople-full.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const PERMA_KEY_ID = 'cGWpF4F5rThx';
const PERMA_KEY_SECRET = '9d314d52-573e-4fb2-9953-1ecd1e9bdac7';
const BATCH_SIZE = 50; // plants per page from list endpoint
const DETAIL_DELAY_MS = 50; // delay between detail fetches to be nice
const PAGE_DELAY_MS = 200; // delay between list pages

const prisma = new PrismaClient();
const STATE_FILE = '/tmp/permapeople-import-state.json';

interface PermapeoplePlant {
  id: number;
  name: string;
  slug: string;
  scientific_name: string | null;
  description: string | null;
  link: string;
  images?: { thumb?: string; title?: string };
  data?: { key: string; value: string }[];
}

function loadState(): { lastId: number; imported: number; errors: number } {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastId: 0, imported: 0, errors: 0 };
  }
}

function saveState(state: { lastId: number; imported: number; errors: number }) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchPage(lastId: number): Promise<PermapeoplePlant[]> {
  const url = `https://permapeople.org/api/plants?last_id=${lastId}&limit=${BATCH_SIZE}`;
  const res = await fetch(url, {
    headers: {
      'x-permapeople-key-id': PERMA_KEY_ID,
      'x-permapeople-key-secret': PERMA_KEY_SECRET,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch page (last_id=${lastId}): ${res.status}`);
  const data = await res.json() as { plants: PermapeoplePlant[] };
  return data.plants ?? [];
}

async function fetchDetail(id: number): Promise<PermapeoplePlant | null> {
  try {
    const res = await fetch(`https://permapeople.org/api/plants/${id}`, {
      headers: {
        'x-permapeople-key-id': PERMA_KEY_ID,
        'x-permapeople-key-secret': PERMA_KEY_SECRET,
      },
    });
    if (!res.ok) return null;
    return await res.json() as PermapeoplePlant;
  } catch {
    return null;
  }
}

function kv(data: Record<string, string>, key: string): string | null {
  return data[key] ?? null;
}

function parseZone(raw: string | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const m = raw.match(/(\d+)-(\d+)/);
  if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };
  const s = raw.match(/(\d+)/);
  if (s) return { min: parseInt(s[1]), max: parseInt(s[1]) };
  return { min: null, max: null };
}

function parseHeight(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^([\d.]+)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (val === 0) return null;
  return val < 1 ? `${Math.round(val * 100)}cm` : `${val}m`;
}

function mapWater(raw: string | null): string | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('dry')) return 'low';
  if (r.includes('wet') || r.includes('high')) return 'high';
  if (r.includes('moist')) return 'moderate';
  return null;
}

function mapLight(raw: string | null): string | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('full sun')) return 'full sun';
  if (r.includes('partial')) return 'partial shade';
  if (r.includes('full shade') || r.includes('shade')) return 'shade';
  return null;
}

function mapLayer(raw: string | null): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    'Trees': 'tree', 'Shrubs': 'shrub', 'Herbs': 'herb',
    'Vines': 'vine', 'Ground cover': 'ground cover',
  };
  return map[raw] ?? raw;
}

function parseData(data: { key: string; value: string }[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of data ?? []) {
    result[item.key] = item.value;
  }
  return result;
}

async function upsertPlant(plant: PermapeoplePlant): Promise<boolean> {
  try {
    const d = parseData(plant.data ?? []);
    const zone = parseZone(kv(d, 'USDA Hardiness zone'));
    const lifeCycle = kv(d, 'Life cycle') ?? '';
    const isAnnual = lifeCycle.toLowerCase() === 'annual';

    // Image URLs
    const imageThumb = plant.images?.thumb ?? null;
    const imageTitle = plant.images?.title ?? null;

    const germMatch = (kv(d, 'Germination time') ?? '').match(/(\d+)\s*days?/i);
    const daysToGermination = germMatch ? parseInt(germMatch[1]) : null;

    // Extract Wikipedia URL for attribution
    const wikipediaUrl = kv(d, 'Wikipedia');
    const pfafUrl = kv(d, 'Plants For A Future');
    const careNotes = wikipediaUrl || pfafUrl
      ? `Source: Permapeople (CC BY-SA 4.0). Wikipedia: ${wikipediaUrl ?? 'N/A'}. PFAF: ${pfafUrl ?? 'N/A'}`
      : `Imported from Permapeople (CC BY-SA 4.0)`;

    const plantData = {
      commonName: plant.name,
      scientificName: plant.scientific_name ?? null,
      family: kv(d, 'Family'),
      description: plant.description ?? null,
      category: mapLayer(kv(d, 'Layer')),
      sunlight: mapLight(kv(d, 'Light requirement')),
      waterNeeds: mapWater(kv(d, 'Water requirement')),
      soilType: kv(d, 'Soil type'),
      soilPh: kv(d, 'Soil pH'),
      zoneMin: zone.min,
      zoneMax: zone.max,
      matureHeight: parseHeight(kv(d, 'Height')),
      matureSpread: parseHeight(kv(d, 'Width')),
      perennialYears: isAnnual ? 1 : null,
      spacing: kv(d, 'Spacing'),
      daysToGermination,
      growthHabit: kv(d, 'Growth'),
      careNotes,
      imageUrl: imageTitle || imageThumb || null,
      thumbnailUrl: imageThumb || null,
      permapeopleUrl: `https://permapeople.org${plant.link}`,
      currentVersion: 1,
    };

    const whereClause = plant.scientific_name
      ? { scientificName: plant.scientific_name }
      : { commonName: plant.name };

    const existing = await prisma.plantEntry.findFirst({ where: whereClause });

    if (existing) {
      await prisma.plantEntry.update({
        where: { id: existing.id },
        data: plantData as any,
      });
    } else {
      await prisma.plantEntry.create({ data: plantData as any });
    }
    return true;
  } catch (err: any) {
    console.error(`[${plant.name}] error: ${err.message}`);
    return false;
  }
}

async function main() {
  const state = loadState();
  let { lastId, imported, errors } = state;

  console.log(`Resuming from last_id=${lastId} (imported=${imported}, errors=${errors})\n`);

  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    pageCount++;
    const page = await fetchPage(lastId);

    if (page.length === 0) {
      hasMore = false;
      console.log('No more plants — done!');
      break;
    }

    const lastIdInPage = page[page.length - 1].id;
    console.log(`Page ${pageCount}: fetching details for ${page.length} plants (ids ${page[0].id}..${lastIdInPage})...`);

    for (const summary of page) {
      // Fetch full detail (includes images)
      const detail = await fetchDetail(summary.id);
      const plantToImport = detail ?? summary;

      const ok = await upsertPlant(plantToImport);
      if (ok) imported++;
      else errors++;

      lastId = summary.id;

      // Throttle
      await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
    }

    // Save checkpoint
    saveState({ lastId, imported, errors });

    // If we got fewer than BATCH_SIZE, we're at the end
    if (page.length < BATCH_SIZE) {
      hasMore = false;
    }

    console.log(`Running total: ${imported} imported, ${errors} errors\n`);
    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }

  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Total imported: ${imported}`);
  console.log(`Total errors: ${errors}`);
  console.log(`Total in DB: ${await prisma.plantEntry.count()}`);

  // Clean up state file on completion
  fs.unlinkSync(STATE_FILE);

  await prisma.$disconnect();
}

main().catch(console.error);
