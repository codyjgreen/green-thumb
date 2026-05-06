/**
 * USDA Plants Database Import Script
 *
 * Downloads the USDA PLANTS Database CSV (or reads from a local file) and
 * upserts PlantEntry records by scientificName.
 *
 * Usage:
 *   USDA_CSV_PATH=/path/to/plants.csv npm run import:usda
 *   npm run import:usda -- --url https://plants.usda.gov/all/download
 *   npm run import:usda -- --url https://plants.usda.gov/all/download --dry-run
 */

import { parseArgs } from 'node:util';
import { readFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createInterface } from 'node:fs';
import { AsyncIterable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Prisma ────────────────────────────────────────────────────────────────────
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert hardiness letter codes to numeric zone ranges */
function hardinessLetterToZones(code: string | undefined): { zoneMin: number | null; zoneMax: number | null } {
  if (!code) return { zoneMin: null, zoneMax: null };
  // Codes are like "4a", "5b", "7", "10"
  const match = code.match(/^(\d+)([a-z])?/i);
  if (!match) return { zoneMin: null, zoneMax: null };
  const zone = parseInt(match[1], 10);
  const sub = match[2]?.toLowerCase();
  // a → -1 (cold end), b → +1 (warm end), no sub → middle
  const subOffset = sub === 'a' ? -1 : sub === 'b' ? 1 : 0;
  return {
    zoneMin: Math.max(1, zone + subOffset - 1),
    zoneMax: Math.min(13, zone + subOffset + 1),
  };
}

/** Derive category from Growth Habit + Duration */
function deriveCategory(growthHabit: string | undefined, duration: string | undefined): string | null {
  const gh = (growthHabit ?? '').toLowerCase();
  const dur = (duration ?? '').toLowerCase();

  if (gh.includes('tree') || gh.includes('woody')) return 'tree';
  if (gh.includes('vine') || gh.includes('climbing') || gh.includes('twining')) return 'vine';
  if (gh.includes('grass') || gh.includes('sedge') || gh.includes('rush')) return 'grass';
  if (gh.includes('fern')) return 'fern';
  if (dur.includes('annual') || dur.includes('biennial')) return 'herb';
  if (gh.includes('herb') || gh.includes('forb') || gh.includes('subshrub')) {
    if (dur.includes('perennial')) return 'herb';
    return 'herb';
  }
  if (gh.includes('shrub')) return 'shrub';

  // heuristics based on common names (passed via row later if needed)
  return null;
}

/** Map a USDA CSV row to plant fields */
function mapUsdaRow(row: Record<string, string>): {
  commonName: string;
  scientificName: string;
  family: string | null;
  category: string | null;
  sunlight: string | null;
  waterNeeds: string | null;
  soilPh: string | null;
  zoneMin: number | null;
  zoneMax: number | null;
  description: string | null;
  growthHabit: string | null;
} {
  const scientificName = (row['Scientific Name'] ?? '').trim();
  const commonName = (row['Common Name'] ?? '').trim();
  const family = (row['Family'] ?? '').trim() || null;
  const growthHabit = (row['Growth Habit'] ?? '').trim() || undefined;
  const duration = (row['Duration'] ?? '').trim();
  const category = deriveCategory(growthHabit, duration);

  const sunVal = (row['Sun Exposure'] ?? '').trim().toLowerCase();
  const sunlight =
    sunVal.includes('full sun') ? 'full sun'
    : sunVal.includes('partial') ? 'partial shade'
    : sunVal.includes('shade') ? 'shade'
    : sunVal || null;

  const moisture = (row['Soil Moisture'] ?? '').trim().toLowerCase();
  const waterNeeds =
    moisture.includes('anaerobic') ? 'high'
    : moisture.includes('average') || moisture.includes('moderate') ? 'moderate'
    : moisture.includes('low') ? 'low'
    : moisture || null;

  // pH is often a range like "6.0-7.5"
  const ph = (row['pH'] ?? '').trim() || null;

  const hardiness = (row['Hardiness'] ?? '').trim();
  const { zoneMin, zoneMax } = hardinessLetterToZones(hardiness);

  const description = [
    row['Growth Habit'] ? `Growth Habit: ${row['Growth Habit'].trim()}` : '',
    row['Duration'] ? `Duration: ${row['Duration'].trim()}` : '',
    row['Toxicity'] ? `Toxicity: ${row['Toxicity'].trim()}` : '',
  ].filter(Boolean).join('. ') || null;

  return {
    commonName: commonName || scientificName,
    scientificName,
    family,
    category,
    sunlight,
    waterNeeds,
    soilPh: ph,
    zoneMin,
    zoneMax,
    description: description || null,
    growthHabit: growthHabit || null,
  };
}

/** Parse a USDA-style CSV into an async iterable of rows */
async function* parseCsv(filename: string): AsyncIterable<Record<string, string>> {
  const lines = createInterface(createReadStream(filename));
  let headers: string[] = [];
  let lineNum = 0;

  for await (const rawLine of lines) {
    lineNum++;
    if (lineNum === 1) {
      headers = rawLine.split('|').map((h) => h.trim().replace(/^"|"$/g, ''));
      continue;
    }
    if (!rawLine.trim()) continue;

    const values = rawLine.split('|').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i] ?? '';
    }
    yield row;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { values: args } = parseArgs({
    options: {
      url: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  let csvPath = process.env['USDA_CSV_PATH'];
  const url = args['url'] as string | undefined;
  const dryRun = args['dry-run'] as boolean;

  if (!csvPath && !url) {
    console.error('Error: Provide either USDA_CSV_PATH=/path/to/plants.csv or --url <url>');
    process.exit(1);
  }

  let rowsImported = 0;
  let rowsSkipped = 0;
  let rowsUpdated = 0;
  let rowsCreated = 0;
  let errors = 0;

  // ── Download CSV if URL provided ──────────────────────────────────────
  let inputPath = csvPath;

  if (url) {
    console.log(`[usda] Downloading USDA CSV from ${url} ...`);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[usda] Download failed: ${response.statusText}`);
      process.exit(1);
    }
    inputPath = join(__dirname, '..', 'usda_temp.csv');
    await pipeline(response.body!, createWriteStream(inputPath));
    console.log(`[usda] Downloaded to ${inputPath}`);
  }

  console.log(`[usda] Processing ${inputPath} ... (dry-run=${dryRun})`);
  console.log('[usda] (Dry-run mode — no database changes will be made)');

  let count = 0;
  let lastLog = 0;

  try {
    for await (const row of parseCsv(inputPath)) {
      count++;
      const scientificName = (row['Scientific Name'] ?? '').trim();

      if (!scientificName) {
        rowsSkipped++;
        continue;
      }

      const mapped = mapUsdaRow(row);

      if (dryRun) {
        if (count % 500 === 0) {
          console.log(`[usda] dry-run: processed ${count} rows (no DB writes)`);
        }
        continue;
      }

      try {
        const existing = await prisma.plantEntry.findFirst({
          where: { scientificName: mapped.scientificName },
        });

        if (existing) {
          await prisma.plantEntry.update({
            where: { id: existing.id },
            data: {
              commonName: mapped.commonName || existing.commonName,
              family: mapped.family ?? existing.family,
              category: mapped.category ?? existing.category,
              sunlight: mapped.sunlight ?? existing.sunlight,
              waterNeeds: mapped.waterNeeds ?? existing.waterNeeds,
              soilPh: mapped.soilPh ?? existing.soilPh,
              zoneMin: mapped.zoneMin ?? existing.zoneMin,
              zoneMax: mapped.zoneMax ?? existing.zoneMax,
              description: mapped.description ?? existing.description,
              growthHabit: mapped.growthHabit ?? existing.growthHabit,
              currentVersion: (existing.currentVersion ?? 1) + 1,
            },
          });
          rowsUpdated++;
        } else {
          await prisma.plantEntry.create({
            data: {
              commonName: mapped.commonName,
              scientificName: mapped.scientificName,
              family: mapped.family,
              category: mapped.category,
              sunlight: mapped.sunlight,
              waterNeeds: mapped.waterNeeds,
              soilPh: mapped.soilPh,
              zoneMin: mapped.zoneMin,
              zoneMax: mapped.zoneMax,
              description: mapped.description,
              growthHabit: mapped.growthHabit,
              currentVersion: 1,
            },
          });
          rowsCreated++;
        }
        rowsImported++;
      } catch (err) {
        errors++;
        console.error(`[usda] Row ${count} (${scientificName}) error:`, err instanceof Error ? err.message : err);
      }

      if (count - lastLog >= 100) {
        lastLog = count;
        console.log(`[usda] Processed ${count} rows | imported: ${rowsImported} | updated: ${rowsUpdated} | created: ${rowsCreated} | skipped: ${rowsSkipped} | errors: ${errors}`);
      }
    }
  } finally {
    await prisma.$disconnect();
    if (url && inputPath) {
      // Don't delete in dry-run so you can inspect it
      if (!dryRun) {
        const { unlinkSync } = await import('node:fs');
        try { unlinkSync(inputPath); } catch { /* ignore */ }
      }
    }
  }

  console.log('\n[usda] Done!');
  console.log(`  Total rows processed : ${count}`);
  console.log(`  Imported (updated)  : ${rowsUpdated}`);
  console.log(`  Imported (created) : ${rowsCreated}`);
  console.log(`  Skipped (no sci name): ${rowsSkipped}`);
  console.log(`  Errors              : ${errors}`);
}

main().catch(async (err) => {
  console.error('[usda] Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
