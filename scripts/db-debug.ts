import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  // Handle both [] (empty array) and 'null'::jsonb (JSON null stored as value)
  const companionResult = await p.$executeRaw`
    UPDATE "plant_entries"
    SET "companionPlants" = NULL
    WHERE
      ("companionPlants" = '[]'::jsonb)
      OR (jsonb_typeof("companionPlants") = 'null'::text)
  `

  const incompatibleResult = await p.$executeRaw`
    UPDATE "plant_entries"
    SET "incompatiblePlants" = NULL
    WHERE
      ("incompatiblePlants" = '[]'::jsonb)
      OR (jsonb_typeof("incompatiblePlants") = 'null'::text)
  `

  console.log(`  companionPlants cleared: ${companionResult} rows`)
  console.log(`  incompatiblePlants cleared: ${incompatibleResult} rows`)

  await p.$disconnect()
  console.log('\n[fix-arrays] Done!')
}

main().catch(async (err) => {
  console.error(err)
  await p.$disconnect()
  process.exit(1)
})
