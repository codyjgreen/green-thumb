/**
 * Direct plant ingest — bypasses Redis caching and calls Ollama directly.
 * Use this when Redis is unavailable.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OLLAMA_URL = 'http://192.168.0.27:11434';
const MODEL = 'nomic-embed-text';

function plantToText(p: any): string {
  const parts: string[] = [];
  parts.push(`Plant: ${p.commonName}`);
  if (p.scientificName) parts.push(`Scientific name: ${p.scientificName}`);
  if (p.variety) parts.push(`Variety: ${p.variety}`);
  if (p.family) parts.push(`Family: ${p.family}`);
  if (p.category) parts.push(`Category: ${p.category}`);
  if (p.description) parts.push(`Description: ${p.description}`);
  if (p.sunlight) parts.push(`Sunlight: ${p.sunlight}`);
  if (p.waterNeeds) parts.push(`Water needs: ${p.waterNeeds}`);
  if (p.soilType) parts.push(`Soil type: ${p.soilType}`);
  if (p.soilPh) parts.push(`Soil pH: ${p.soilPh}`);
  if (p.zoneMin && p.zoneMax) parts.push(`Hardiness zones: ${p.zoneMin} to ${p.zoneMax}`);
  if (p.frostTolerance) parts.push(`Frost tolerance: ${p.frostTolerance}`);
  if (p.plantingDepth) parts.push(`Planting depth: ${p.plantingDepth}`);
  if (p.spacing) parts.push(`Spacing: ${p.spacing}`);
  if (p.daysToGermination) parts.push(`Days to germination: ${p.daysToGermination}`);
  if (p.daysToMaturity) parts.push(`Days to maturity: ${p.daysToMaturity}`);
  if (p.matureHeight) parts.push(`Mature height: ${p.matureHeight}`);
  if (p.matureSpread) parts.push(`Mature spread: ${p.matureSpread}`);
  if (p.growthHabit) parts.push(`Growth habit: ${p.growthHabit}`);
  if (p.perennialYears) parts.push(`Perennial for ${p.perennialYears} years`);
  if (p.harvestWindow) parts.push(`Harvest window: ${p.harvestWindow}`);
  if (p.harvestIndicators) parts.push(`Harvest indicators: ${p.harvestIndicators}`);
  if (p.careNotes) parts.push(`Care notes: ${p.careNotes}`);
  if (p.companionPlants?.length) parts.push(`Companion plants: ${p.companionPlants.join(', ')}`);
  if (p.incompatiblePlants?.length) parts.push(`Incompatible plants: ${p.incompatiblePlants.join(', ')}`);
  if (p.commonPests?.length) parts.push(`Common pests: ${p.commonPests.join(', ')}`);
  if (p.commonDiseases?.length) parts.push(`Common diseases: ${p.commonDiseases.join(', ')}`);
  return parts.join('. ');
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  const data = await res.json() as any;
  return data.embeddings?.[0] ?? data.embedding ?? [];
}

function sanitize(text: string): string {
  return text.replace(/\0/g, '').toWellFormed();
}

async function main() {
  // Clean up any previous attempt
  await prisma.chunkEmbedding.deleteMany({ where: { chunk: { book: { title: { startsWith: '🌱' } } } } });
  await prisma.bookChunk.deleteMany({ where: { book: { title: { startsWith: '🌱' } } } });
  await prisma.book.deleteMany({ where: { title: { startsWith: '🌱' } } });

  const plants = await prisma.plantEntry.findMany();
  console.log(`Ingesting ${plants.length} plants...`);

  const sections = plants.map(p => ({
    title: p.commonName,
    content: plantToText(p),
    plant: p,
  }));

  const book = await prisma.book.create({
    data: {
      title: '🌱 Plant Encyclopedia',
      author: 'Green-Thumb DB',
      filePath: 'plant-encyclopedia',
      fileType: 'synthetic',
      fileSize: sections.reduce((a, s) => a + s.content.length, 0),
      processedAt: new Date(),
    },
  });
  console.log(`Book created: ${book.id}`);

  let done = 0;
  const start = Date.now();

  for (const section of sections) {
    const text = section.content;
    if (text.trim().length < 50) { done++; continue; }

    try {
      const embedding = await embedText(text);
      const sanitized = sanitize(text);

      const chunk = await prisma.bookChunk.create({
        data: {
          bookId: book.id,
          chapter: section.title,
          contentType: 'plant',
          contentText: sanitized,
          tokenCount: Math.ceil(sanitized.length / 4),
        },
      });

      await prisma.chunkEmbedding.create({
        data: {
          chunkId: chunk.id,
          model: MODEL,
          dimension: embedding.length,
          vector: embedding,
        },
      });

      done++;
      if (done % 50 === 0 || done === sections.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const rate = (done / (Date.now() - start) * 1000).toFixed(1);
        console.error(`[${elapsed}s] Embedded ${done}/${sections.length} plants (${rate}/s)`);
      }
    } catch (err) {
      console.error(`Failed to embed "${section.title}": ${err}`);
      done++;
    }
  }

  console.log(`\nDone! Embedded ${done} plants in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
