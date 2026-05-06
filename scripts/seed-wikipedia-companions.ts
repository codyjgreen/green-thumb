/**
 * Parse Wikipedia's List of Companion Plants wikitext table and
 * ingest relationships into Green-Thumb DB.
 *
 * Wikipedia table columns:
 * 1. Plant (common name)
 * 2. Scientific name
 * 3. Helped by (companions that help this plant grow)
 * 4. Helps (what this plant helps)
 * 5. Avoid (antagonists - plants that harm this plant)
 * 6. (repel/distract column)
 * 7. (attracts column)
 *
 * Run: npx tsx scripts/seed-wikipedia-companions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Fetch and parse Wikipedia wikitext table
async function fetchWikipediaCompanions(): Promise<any[]> {
  const res = await fetch(
    'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_companion_plants&prop=wikitext&format=json'
  );
  const data = await res.json() as any;
  const wikitext = data.parse.wikitext['*'];

  const lines = wikitext.split('\n');
  const rows: string[] = [];

  // Collect table rows (lines starting with | or |-)
  for (const line of lines) {
    if (line.startsWith('|-') || line.match(/^\|/)) {
      rows.push(line);
    }
  }

  console.log(`Found ${rows.length} table rows`);

  const plants: any[] = [];

  for (const row of rows) {
    // Skip style rows
    if (row.includes('style=') && !row.match(/\|.*\|/)) continue;

    // Split by | and clean up
    const cells = row
      .replace(/\|-/, '')
      .split('|')
      .map((c: string) => {
        // Remove wiki markup: ''' ''' bold, '' italic, [[ ]] links, <ref>...</ref>
        return c
          .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
          .replace(/\{\{[^}]*\}\}/g, '')
          .replace(/\[\[([^|\]]+?\|)?([^\]]+?)\]\]/g, '$2')
          .replace(/'''/g, '')
          .replace(/''/g, '')
          .replace(/<br\s*\/?>/gi, ', ')
          .replace(/\n/g, ', ')
          .replace(/\|/g, '')
          .trim();
      })
      .filter((c: string) => c.length > 0 && c !== '-' && !c.startsWith('background'));

    if (cells.length < 2) continue;

    // cells[0] = plant name (may be bold/allium)
    // cells[1] = scientific name
    // cells[2] = helped by
    // cells[3] = helps
    // cells[4] = avoid
    // cells[5] = repels/distracts
    // cells[6] = attracts

    const commonName = cells[0].replace(/'''/g, '').trim();
    const scientificName = cells[1]?.replace(/''/g, '').trim() || null;

    // Parse comma-separated plant lists
    const parseList = (str: string | undefined): string[] => {
      if (!str || str === '-' || str === '') return [];
      return str
        .split(',')
        .map((s: string) => s.trim().toLowerCase())
        .filter((s: string) => s.length > 1 && !s.startsWith('see '));
    };

    const helpedBy = parseList(cells[2]);
    const helps = parseList(cells[3]);
    const avoid = parseList(cells[4]);

    if (helpedBy.length > 0 || helps.length > 0 || avoid.length > 0) {
      plants.push({
        commonName,
        scientificName,
        helpedBy,
        helps,
        avoid,
      });
    }
  }

  return plants;
}

// Normalize plant name to match Permapeople names
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+(l|s)$/, '') // trailing "l" or "s" (plural)
    .trim();
}

// Find plant in Green-Thumb DB by name
async function findPlantId(name: string): Promise<string | null> {
  const normalized = normalizeName(name);

  // Try exact match first
  const plant = await prisma.plantEntry.findFirst({
    where: {
      OR: [
        { commonName: { equals: name, mode: 'insensitive' } },
        { scientificName: { equals: name, mode: 'insensitive' } },
        // Also try without trailing s
        { commonName: { equals: normalized, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });

  return plant?.id ?? null;
}

// Build companion plants JSON from a list of plant names
async function buildCompanionList(names: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const name of names) {
    const id = await findPlantId(name);
    if (id) result.push(name);
  }
  return result;
}

async function main() {
  console.log('Fetching Wikipedia List of Companion Plants...\n');
  const plants = await fetchWikipediaCompanions();
  console.log(`Parsed ${plants.length} plants with relationship data\n`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const plant of plants) {
    try {
      // Find the plant in our DB
      const plantId = await findPlantId(plant.commonName);
      // Find the plant in our DB
      let matchedId = await findPlantId(plant.commonName);
      let matchedName = plant.commonName;
      if (!matchedId) {
        // Try partial match - first word
        const firstWord = plant.commonName.split(' ')[0].replace(/[^a-z]/gi, '');
        if (firstWord.length > 2) {
          const partial = await prisma.plantEntry.findFirst({
            where: {
              commonName: { contains: firstWord, mode: 'insensitive' },
            },
            select: { id: true, commonName: true },
          });
          if (partial) {
            matchedId = partial.id;
            matchedName = partial.commonName;
            console.log(`  [match] "${plant.commonName}" → "${partial.commonName}"`);
          }
        }
      }

      if (!matchedId) {
        console.log(`  [skip] "${plant.commonName}" not found in DB`);
        skipped++;
        continue;
      }

      const companionPlants = await buildCompanionList([...plant.helpedBy, ...plant.helps]);
      const incompatiblePlants = await buildCompanionList(plant.avoid);

      if (companionPlants.length === 0 && incompatiblePlants.length === 0) {
        skipped++;
        continue;
      }

      await prisma.plantEntry.update({
        where: { id: matchedId },
        data: {
          companionPlants: companionPlants.length > 0 ? companionPlants as any : undefined,
          incompatiblePlants: incompatiblePlants.length > 0 ? incompatiblePlants as any : undefined,
        },
      });

      updated++;
      if (updated % 10 === 0) {
        console.log(`Updated ${updated} plants...`);
      }
    } catch (err: any) {
      console.error(`  [error] "${plant.commonName}": ${err.message}`);
      errors++;
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (not found): ${skipped}`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch(console.error);
