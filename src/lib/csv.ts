import type { PlantImport, PlantExportRow } from './plant-types.js';

// RFC4180-compliant CSV parser — handles quoted fields, embedded CRLF, and escaped quotes
export function parseCsvToPlants(content: string): { plants: PlantImport[]; errors: string[] } {
  const errors: string[] = [];
  const plants: PlantImport[] = [];

  const lines = splitCsvLines(content);
  if (lines.length < 2) {
    errors.push('CSV must have a header row and at least one data row');
    return { plants, errors };
  }

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  const headerIdx = buildHeaderIndex(headers);

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseRow(line);

    const cell = (header: string): string | undefined => {
      const idx = headerIdx[header];
      if (idx === undefined) return undefined;
      return values[idx]?.trim() || undefined;
    };

    const numCell = (header: string): number | undefined => {
      const idx = headerIdx[header];
      if (idx === undefined) return undefined;
      const raw = values[idx]?.trim();
      if (!raw) return undefined;
      const num = Number(raw);
      return Number.isFinite(num) ? num : undefined;
    };

    const plant: Partial<PlantImport> = {};

    try {
      const commonName = cell('commonName');
      if (!commonName) {
        errors.push(`Row ${rowNum}: commonName is required`);
        continue;
      }
      plant.commonName = commonName;

      plant.scientificName = cell('scientificName');
      plant.variety = cell('variety');
      plant.family = cell('family');
      plant.category = cell('category');
      plant.sunlight = cell('sunlight');
      plant.waterNeeds = cell('waterneeds');
      plant.soilType = cell('soiltype');
      plant.soilPh = cell('soilph');
      plant.frostTolerance = cell('frosttolerance');
      plant.plantingDepth = cell('plantingdepth');
      plant.spacing = cell('spacing');
      plant.matureHeight = cell('matureheight');
      plant.matureSpread = cell('maturespread');
      plant.growthHabit = cell('growthhabit');
      plant.harvestWindow = cell('harvestwindow');
      plant.harvestIndicators = cell('harvestindicators');
      plant.description = cell('description');
      plant.careNotes = cell('carenotes');

      plant.zoneMin = numCell('zonemin');
      plant.zoneMax = numCell('zonemax');
      plant.daysToGermination = numCell('daystogermination');
      plant.daysToMaturity = numCell('daystomaturity');
      plant.perennialYears = numCell('perennialyears');

      const companion = cell('companionplants');
      plant.companionPlants = companion ? companion.split(';').map((s) => s.trim()).filter(Boolean) : undefined;
      const incompatible = cell('incompatibleplants');
      plant.incompatiblePlants = incompatible ? incompatible.split(';').map((s) => s.trim()).filter(Boolean) : undefined;
      const pests = cell('commonpests');
      plant.commonPests = pests ? pests.split(';').map((s) => s.trim()).filter(Boolean) : undefined;
      const diseases = cell('commondiseases');
      plant.commonDiseases = diseases ? diseases.split(';').map((s) => s.trim()).filter(Boolean) : undefined;

      plants.push(plant as PlantImport);
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { plants, errors };
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    idx[headers[i]] = i;
  }
  return idx;
}

// Split content into CSV lines respecting quoted fields
function splitCsvLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if ((ch === '\r' && next === '\n') || ch === '\n') {
      if (!inQuotes) {
        lines.push(current);
        current = '';
        if (ch === '\r') i++;
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current) lines.push(current);
  return lines;
}

// Parse a single CSV row into fields
function parseRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  fields.push(current);
  return fields;
}

// Convert an array of PlantExportRow to an RFC4180-compliant CSV string
export function plantsToCsv(plants: PlantExportRow[]): string {
  const allHeaders = [
    'commonName', 'scientificName', 'variety', 'family', 'category',
    'sunlight', 'waterNeeds', 'soilType', 'soilPh', 'zoneMin', 'zoneMax',
    'frostTolerance', 'plantingDepth', 'spacing', 'daysToGermination',
    'daysToMaturity', 'matureHeight', 'matureSpread', 'growthHabit',
    'perennialYears', 'companionPlants', 'incompatiblePlants', 'commonPests',
    'commonDiseases', 'harvestWindow', 'harvestIndicators', 'description', 'careNotes',
  ];

  const rows: string[] = [allHeaders.join(',')];

  for (const plant of plants) {
    const values = allHeaders.map((header) => {
      const val = (plant as unknown as Record<string, unknown>)[header];
      return encodeCsvValue(val);
    });
    rows.push(values.join(','));
  }

  return rows.join('\r\n');
}

function encodeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `"${value.join(';')}"`;
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
