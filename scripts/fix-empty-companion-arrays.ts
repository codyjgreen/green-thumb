/**
 * Fix empty companion/incompatible arrays and JSON-null values.
 * - Empty arrays [] → NULL (so seed scripts can re-enrich)
 * - JSON 'null' values → NULL (these are scalar, not SQL NULL)
 *
 * Run: cd green-thumb && ./node_modules/.bin/tsx scripts/fix-empty-companion-arrays.ts
 */

const { PrismaClient } = await import('@prisma/client')
const p = new PrismaClient()

async function main() {
  console.log('[fix-arrays] Clearing empty/invalid companion data...\n')

  const companionResult = await p.$executeRaw`
    UPDATE "plant_entries"
    SET "companionPlants" = NULL
    WHERE "companionPlants" = '[]'::jsonb
       OR jsonb_typeof("companionPlants") = 'null'::text
  `

  const incompatibleResult = await p.$executeRaw`
    UPDATE "plant_entries"
    SET "incompatiblePlants" = NULL
    WHERE "incompatiblePlants" = '[]'::jsonb
       OR jsonb_typeof("incompatiblePlants") = 'null'::text
  `

  console.log(`  companionPlants cleared:  ${companionResult} rows`)
  console.log(`  incompatiblePlants cleared: ${incompatibleResult} rows`)
  console.log('\n[fix-arrays] Done! Plants can now be re-enriched.')
  await p.$disconnect()
}

main().catch(async (err) => {
  console.error('[fix-arrays] Fatal:', err)
  await p.$disconnect()
  process.exit(1)
})
