/**
 * Batch import plants from Permapeople into Green-Thumb DB.
 * Run: npx tsx scripts/seed-permapeople.ts
 */
import { PrismaClient } from '@prisma/client';

const PERMA_KEY_ID = 'cGWpF4F5rThx';
const PERMA_KEY_SECRET = '9d314d52-573e-4fb2-9953-1ecd1e9bdac7';

const prisma = new PrismaClient();

// Common vegetable, herb, and fruit plants to import
const SEARCH_TERMS = [
  // Vegetables
  'tomato', 'pepper', 'cucumber', 'zucchini', 'squash', 'pumpkin',
  'carrot', 'onion', 'garlic', 'lettuce', 'spinach', 'kale', 'chard',
  'broccoli', 'cauliflower', 'cabbage', 'brussels sprouts', 'pea',
  'bean', 'corn', 'potato', 'sweet potato', 'radish', 'beet',
  'celery', 'asparagus', 'artichoke', 'eggplant', 'okra',
  // Herbs
  'basil', 'parsley', 'cilantro', 'dill', 'mint', 'rosemary',
  'thyme', 'oregano', 'sage', 'lavender', 'chives', 'fennel',
  'lemon balm', 'tarragon', 'marjoram', 'bay laurel',
  // Fruits & Berries
  'strawberry', 'blueberry', 'raspberry', 'blackberry',
  'apple', 'pear', 'cherry', 'peach', 'plum', 'apricot',
  'grape', 'melon', 'watermelon', 'cantaloupe',
  'lemon', 'lime', 'orange', 'fig', 'pomegranate',
  // Flowers &Companion
  'marigold', 'nasturtium', 'sunflower', 'zinnia',
  // Trees & Shrubs
  'elderberry', 'hazelnut', 'walnut', 'almond',
  // Greens
  'arugula', 'endive', 'radicchio', 'bok choy',
];

// Deduplicate by lowercase name
const unique = SEARCH_TERMS.map(t => t.toLowerCase().trim());

async function searchPermapeople(query: string): Promise<any[]> {
  const res = await fetch('https://permapeople.org/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-permapeople-key-id': PERMA_KEY_ID,
      'x-permapeople-key-secret': PERMA_KEY_SECRET,
    },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) {
    console.error(`  [${query}] search failed: ${res.status}`);
    return [];
  }
  const data = await res.json() as { plants: any[] };
  return data.plants ?? [];
}

async function fetchPlantDetail(id: number): Promise<any | null> {
  const res = await fetch(`https://permapeople.org/api/plants/${id}`, {
    headers: {
      'x-permapeople-key-id': PERMA_KEY_ID,
      'x-permapeople-key-secret': PERMA_KEY_SECRET,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

function parseKV(data: Record<string, string>, key: string): string | null {
  return data[key] ?? null;
}

function parseZone(raw: string | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const m = raw.match(/(\d+)-(\d+)/);
  if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };
  const single = raw.match(/(\d+)/);
  if (single) return { min: parseInt(single[1]), max: parseInt(single[1]) };
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

async function upsertPlant(plant: any): Promise<boolean> {
  try {
    const data: Record<string, string> = {};
    for (const item of plant.data ?? []) {
      data[item.key] = item.value;
    }

    const zone = parseZone(parseKV(data, 'USDA Hardiness zone'));
    const height = parseHeight(parseKV(data, 'Height'));
    const widthRaw = parseKV(data, 'Width');
    const width = parseHeight(widthRaw);

    const lifeCycle = parseKV(data, 'Life cycle') ?? '';
    const isAnnual = lifeCycle.toLowerCase() === 'annual';
    const perennialYears = isAnnual ? 1 : null;

    const germMatch = (parseKV(data, 'Germination time') ?? '').match(/(\d+)\s*days?/i);
    const daysToGermination = germMatch ? parseInt(germMatch[1]) : null;

    const whereClause = plant.scientific_name
      ? { scientificName: plant.scientific_name }
      : { commonName: plant.name };

    const existing = await prisma.plantEntry.findFirst({ where: whereClause });

    const plantData = {
      commonName: plant.name,
      scientificName: plant.scientific_name ?? null,
      family: parseKV(data, 'Family'),
      description: plant.description ?? null,
      category: mapLayer(parseKV(data, 'Layer')),
      sunlight: mapLight(parseKV(data, 'Light requirement')),
      waterNeeds: mapWater(parseKV(data, 'Water requirement')),
      soilType: parseKV(data, 'Soil type'),
      soilPh: parseKV(data, 'Soil pH'),
      zoneMin: zone.min,
      zoneMax: zone.max,
      matureHeight: height,
      matureSpread: width,
      perennialYears,
      spacing: parseKV(data, 'Spacing'),
      daysToGermination,
      growthHabit: parseKV(data, 'Growth'),
      careNotes: `Imported from Permapeople (CC BY-SA 4.0). Wikipedia: ${parseKV(data, 'Wikipedia') ?? 'N/A'}. Sources: ${parseKV(data, 'Plants For A Future') ?? 'N/A'}`,
      currentVersion: existing ? undefined : 1,
    };

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
    console.error(`  [${plant.name}] upsert error: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Starting batch import of ${unique.length} plant searches from Permapeople...\n`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const query of unique) {
    process.stdout.write(`Searching: "${query}"... `);

    const results = await searchPermapeople(query);
    if (results.length === 0) {
      console.log('no results');
      continue;
    }

    // Import top result only for each search term
    const top = results[0];
    process.stdout.write(`got "${top.name}" (id=${top.id})... `);

    const detail = await fetchPlantDetail(top.id);
    if (!detail) {
      console.log('failed to fetch detail');
      errors++;
      continue;
    }

    const ok = await upsertPlant(detail);
    if (ok) {
      console.log('imported');
      imported++;
    } else {
      console.log('error');
      errors++;
    }

    // Small delay to be nice to Permapeople
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n--- Done ---`);
  console.log(`Imported: ${imported}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total plants in DB: ${await prisma.plantEntry.count()}`);

  await prisma.$disconnect();
}

main().catch(console.error);
