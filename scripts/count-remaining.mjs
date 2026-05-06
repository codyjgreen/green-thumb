import { PLANT_KNOWLEDGE_BASE } from './plant-knowledge-base.js';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const rows = await p.$queryRaw`SELECT "scientificName" FROM plant_entries WHERE "scientificName" IS NOT NULL`;
const inDb = new Set(rows.map((r) => r.scientificName));
const notInDb = PLANT_KNOWLEDGE_BASE.filter((pl) => !inDb.has(pl.scientificName));

console.log('In DB:', inDb.size, '| Not in DB:', notInDb.length, '| Total KB:', PLANT_KNOWLEDGE_BASE.length);
if (notInDb.length > 0) {
  console.log('First 10 unenriched:', notInDb.slice(0,10).map((pl) => pl.commonName + '[' + pl.scientificName + ']').join(', '));
  const indices = notInDb.slice(0, 30).map((pl) => PLANT_KNOWLEDGE_BASE.indexOf(pl));
  console.log('First 30 indices:', indices.join(','));
}
await p.$disconnect();
