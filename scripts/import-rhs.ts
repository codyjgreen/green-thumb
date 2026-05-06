/**
 * Royal Horticultural Society (RHS) Import Script
 *
 * Template script for importing plant data from an RHS CSV export.
 * The RHS does not provide a public bulk-download API, so you must
 * obtain the data export manually from the RHS website and provide the
 * file path via the RHS_CSV_PATH environment variable.
 *
 * Usage:
 *   RHS_CSV_PATH=/path/to/rhs_plants.csv npm run import:rhs
 *   npm run import:rhs -- --dry-run
 *
 * Expected CSV columns (adjust field mapping to match your export format):
 *   - Plant Name       → commonName
 *   - Scientific Name  → scientificName
 *   - Family           → family
 *   - Category         → category (adjust mapping as needed)
 *   - Aspect / Sun     → sunlight
 *   - Water            → waterNeeds
 *   - Soil pH          → soilPh
 *   - Hardiness        → zoneMin / zoneMax
 *   - Height           → matureHeight
 *   - Spread           → matureSpread
 *   - Habit            → growthHabit
 *   - Description      → description
 */

import { parseArgs } from 'node:util';
import { createReadStream, createInterface } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Prisma ────────────────────────────────────────────────────────────────────
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert hardiness zones to numeric bounds (e.g. "H5" → zoneMin/Max) */
function hardinessToZones(code: string | undefined): { zoneMin: number | null; zoneMax: number | null } {
  if (!code) return { zoneMin: null, zoneMax: null };
  // RHS uses H1c through H7, mapped to zones 1–13
  const match = code.match(/^H(\d+)/i);
  if (!match) return { zoneMin: null, zoneMax: null };
  const h = parseInt(match[1], 10);
  // Approximate mapping H1→zone1..H7→zone13 (RHS H5 ≈ zone 5/6)
  const zone = Math.min(Math.max(h - 4, 1), 13); // rough approximation
  return { zoneMin: zone, zoneMax: zone + 1 };
}

/** Map an RHS CSV row to plant fields */
function mapRhsRow(row: Record<string, string>): {
  commonName: string;
  scientificName: string | null;
  family: string | null;
  category: string | null;
  sunlight: string | null;
  waterNeeds: string | null;
  soilPh: string | null;
  zoneMin: number | null;
  zoneMax: number | null;
  description: string | null;
  matureHeight: string | null;
  matureSpread: string | null;
  growthHabit: string | null;
} {
  const scientificName = (row['Scientific Name'] ?? '').trim() || null;
  const commonName = (row['Plant Name'] ?? '').trim() || scientificName ?? 'Unknown Plant';
  const family = (row['Family'] ?? '').trim() || null;
  const aspect = (row['Aspect / Sun'] ?? '').trim().toLowerCase();
  const sunlight =
    aspect.includes('full sun') || aspect.includes('sun') ? 'full sun'
    : aspect.includes('partial') ? 'partial shade'
    : aspect.includes('shade') ? 'shade'
    : aspect || null;
  const waterNeeds = (row['Water'] ?? '').trim().toLowerCase() || null;
  const soilPh = (row['Soil pH'] ?? '').trim() || null;
  const hardiness = (row['Hardiness'] ?? '').trim();
  const { zoneMin, zoneMax } = hardinessToZones(hardiness);

  return {
    commonName,
    scientificName,
    family,
    category: null,
    sunlight,
    waterNeeds,
    soilPh,
    zoneMin,
    zoneMax,
    description: (row['Description'] ?? '').trim() || null,
    matureHeight: (row['Height'] ?? '').trim() || null,
    matureSpread: (row['Spread'] ?? '').trim() || null,
    growthHabit: (row['Habit'] ?? '').trim() || null,
  };
}

/** Parse a generic CSV into an async iterable of rows */
async function* parseCsv(filename: string) {
  const lines = createInterface(createReadStream(filename));
  let headers: string[] = [];
  let lineNum = 0;

  for await (const rawLine of lines) {
    lineNum++;
    if (lineNum === 1) {
      // Try comma, tab, pipe delimiters
      const delimiter = rawLine.includes('\t') ? '\t' : rawLine.includes('|') ? '|' : ',';
      headers = rawLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    if (!rawLine.trim()) continue;

    const delimiter = headers.join(',').includes('\t') ? '\t' : headers.join(',').includes('|') ? '|' : ',';
    const values = rawLine.split(delimiter).map((v) => v.trim().replace(/^["']|["']$/g, ''));
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
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const csvPath = process.env['RHS_CSV_PATH'];
  const dryRun = args['dry-run'] as boolean;

  if (!csvPath) {
    console.error('Error: RHS_CSV_PATH environment variable is required.');
    console.error('  Export your data from rhs.org.uk and set RHS_CSV_PATH=/path/to/export.csv');
    process.exit(1);
  }

  console.log(`[rhs] Processing ${csvPath} ... (dry-run=${dryRun})`);

  let rowsImported = 0;
  let rowsSkipped = 0;
  let rowsUpdated = 0;
  let rowsCreated = 0;
  let errors = 0;
  let count = 0;
  let lastLog = 0;

  try {
    for await (const row of parseCsv(csvPath)) {
      count++;
      const sciName = (row['Scientific Name'] ?? '').trim();
      const plantName = (row['Plant Name'] ?? '').trim();

      if (!sciName && !plantName) {
        rowsSkipped++;
        continue;
      }

      const mapped = mapRhsRow(row);

      if (dryRun) {
        if (count % 500 === 0) {
          console.log(`[rhs] dry-run: processed ${count} rows (no DB writes)`);
        }
        continue;
      }

      try {
        const where = sciName
          ? { scientificName: mapped.scientificName }
          : { commonName: mapped.commonName };

        const existing = await prisma.plantEntry.findFirst({ where });

        if (existing) {
          await prisma.plantEntry.update({
            where: { id: existing.id },
            data: {
              commonName: mapped.commonName || existing.commonName,
              scientificName: mapped.scientificName ?? existing.scientificName,
              family: mapped.family ?? existing.family,
              sunlight: mapped.sunlight ?? existing.sunlight,
              waterNeeds: mapped.waterNeeds ?? existing.waterNeeds,
              soilPh: mapped.soilPh ?? existing.soilPh,
              zoneMin: mapped.zoneMin ?? existing.zoneMin,
              zoneMax: mapped.zoneMax ?? existing.zoneMax,
              description: mapped.description ?? existing.description,
              matureHeight: mapped.matureHeight ?? existing.matureHeight,
              matureSpread: mapped.matureSpread ?? existing.matureSpread,
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
              sunlight: mapped.sunlight,
              waterNeeds: mapped.waterNeeds,
              soilPh: mapped.soilPh,
              zoneMin: mapped.zoneMin,
              zoneMax: mapped.zoneMax,
              description: mapped.description,
              matureHeight: mapped.matureHeight,
              matureSpread: mapped.matureSpread,
              growthHabit: mapped.growthHabit,
              currentVersion: 1,
            },
          });
          rowsCreated++;
        }
        rowsImported++;
      } catch (err) {
        errors++;
        console.error(`[rhs] Row ${count} error:`, err instanceof Error ? err.message : err);
      }

      if (count - lastLog >= 100) {
        lastLog = count;
        console.log(`[rhs] Processed ${count} rows | imported: ${rowsImported} | updated: ${rowsUpdated} | created: ${rowsCreated} | skipped: ${rowsSkipped} | errors: ${errors}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n[rhs] Done!');
  console.log(`  Total rows processed : ${count}`);
  console.log(`  Imported (updated)  : ${rowsUpdated}`);
  console.log(`  Imported (created)  : ${rowsCreated}`);
  console.log(`  Skipped             : ${rowsSkipped}`);
  console.log(`  Errors              : ${errors}`);
}

main().catch(async (err) => {
  console.error('[rhs] Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
