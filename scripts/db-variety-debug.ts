import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Check variety data distribution
  const withVariety = await p.$queryRaw`
    SELECT COUNT(*) as cnt FROM "plant_entries" WHERE "variety" IS NOT NULL AND "variety" != ''
  `
  console.log('Plants with variety set:', Number(withVariety[0].cnt))

  // Check duplicates (same scientificName with different variety)
  const dupes = await p.$queryRaw`
    SELECT "scientificName", COUNT(*) as cnt
    FROM "plant_entries"
    WHERE "scientificName" IS NOT NULL AND "scientificName" != ''
    GROUP BY "scientificName"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 20
  `
  console.log('\nDuplicate scientificNames (same species, multiple records):')
  console.log(JSON.stringify(dupes.map((r: any) => ({...r, cnt: Number(r.cnt)})), null, 2))

  // Total
  const total = await p.$queryRaw`SELECT COUNT(*) as cnt FROM "plant_entries"`
  console.log('\nTotal plant_entries:', Number(total[0].cnt))

  // Sample some variety records
  const samples = await p.$queryRaw`
    SELECT "commonName", "scientificName", "variety", "category", "companionPlants"
    FROM "plant_entries"
    WHERE "variety" IS NOT NULL AND "variety" != ''
    LIMIT 10
  `
  console.log('\nSample records with variety:')
  console.log(JSON.stringify(samples, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2))

  await p.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await p.$disconnect()
  process.exit(1)
})
