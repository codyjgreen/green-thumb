/**
 * Targeted pass: catch remaining culinary plants that the general
 * recategorize-edibles.ts missed due to complex scientific names
 * or unusual family membership.
 *
 * Run: cd green-thumb && ./node_modules/.bin/tsx scripts/recategorize-edibles-supplemental.ts
 */

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

// Extra families with some edible members that are obscure or misspellable
const BONUS_EDITIBLE_FAMILIES = [
  'Zingiberaceae',   // ginger, turmeric, cardamom, galangal
  'Marantaceae',     // arrowroot
  'Araceae',         // taro, colocasia, arrowroot (some)
  'Nelumbonaceae',   // lotus
  'Cyperaceae',      // chufa (tiger nut), water chestnut
  'Musaceae',        // banana (some ornamental)
  'Cactaceae',       // prickly pear
  'Tamaricaceae',    // tamarisk (some edible)
  'Papaveraceae',    // poppy seeds (some edible)
  'Malvaceae',       // okra, hibiscus
  'Polygonaceae',    // buckwheat, sorrel, rhubarb
  'Basellaceae',     // Malabar spinach
  'Caricaceae',      // papaya
  'Moringaceae',     // moringa
  'Chenopodiaceae',  // lamb's quarters, epazote
  'Erysimaceae',     // gold bead / edible mustard
]

const EDIBLE_KEYWORDS_SUPPLEMENTAL = [
  'taro', 'colocasia', 'elephant ear', 'arrowroot', 'lotus', 'water chestnut',
  'ginger', 'turmeric', 'cardamom', 'galangal', 'grains of paradise',
  'malabar spinach', 'basella', 'chaya',
  'jute', 'roselle', 'okra', 'hibiscus',
  'buckwheat', 'sorrel', 'rhubarb',
  'moringa', 'horseradish', 'wasabi',
  'chickweed', 'lambs quarters', "lamb's quarter", 'epazote', 'muabell',
  'samphire', 'sea asparagus', 'sea bean', 'sea kale',
  'nopal', 'prickly pear', 'nopales',
  'chufa', 'tiger nut', 'yellow nutsedge',
  'papaya', 'pawpaw',
  'cape gooseberry', 'ground cherry', 'physalis',
  'barbadensis', 'aloe vera', 'aloe',
  'pearl millet', 'proso millet', 'finger millet',
  'teff', 'fonio', 'brown mill',
]

const FRUIT_KW = ['persimmon','quince','loquat','jujube','barberry','aronia','serviceberry','hackberry','cornelian cherry','elderberry',' chokeberry','haskap','goji','wolfberry','acai','bacuri']
const HERB_KW_SUPPLEMENTAL = ['lavender','hyssop','savory','marjoram','angelica','lovage','horseradish','rue','tarragon','absinthe','wormwood','elecampane','valerian','boneset','milk thistle','dandelion','borage','evening primrose','elderflower','rose hip','cannabis','hemp']
const VEG_KW_SUPPLEMENTAL = [
  'nopales','seaweed','kale','radicchio','belgian endive','frisée','escarole',
  'crookneck','pattypan','delicata','honeynut','acorn squash','butternut squash',
  'hubbard','spaghetti squash','bitter melon','bottle gourd','luffa','bitter gourd',
  'nopales','aguayo','chia','hemp seed','flax',
]

async function main() {
  console.log('[recategorize-supplemental] Starting supplemental pass...\n')

  const nullPlants = await prisma.plantEntry.findMany({
    where: {
      OR: [{ category: null }, { category: '' }],
    },
    select: {
      id: true,
      commonName: true,
      scientificName: true,
      family: true,
    },
  })

  console.log(`[recategorize-supplemental] ${nullPlants.length} null-category records remaining\n`)

  let updated = 0
  let skipped = 0

  for (const plant of nullPlants) {
    const cn = (plant.commonName ?? '').toLowerCase()
    const sn = (plant.scientificName ?? '').toLowerCase()
    const fam = (plant.family ?? '').toLowerCase()

    let newCategory: string | null = null

    // Check bonus families
    for (const f of BONUS_EDITIBLE_FAMILIES) {
      if (fam.includes(f.toLowerCase())) {
        newCategory = 'vegetable'
        break
      }
    }

    // Check supplemental keywords
    if (!newCategory) {
      for (const kw of EDIBLE_KEYWORDS_SUPPLEMENTAL) {
        if (cn.includes(kw) || sn.includes(kw)) {
          newCategory = 'vegetable'
          break
        }
      }
    }
    if (!newCategory) {
      for (const kw of FRUIT_KW) {
        if (cn.includes(kw) || sn.includes(kw)) {
          newCategory = 'fruit'
          break
        }
      }
    }
    if (!newCategory) {
      for (const kw of HERB_KW_SUPPLEMENTAL) {
        if (cn.includes(kw) || sn.includes(kw)) {
          newCategory = 'herb'
          break
        }
      }
    }
    if (!newCategory) {
      for (const kw of VEG_KW_SUPPLEMENTAL) {
        if (cn.includes(kw) || sn.includes(kw)) {
          newCategory = 'vegetable'
          break
        }
      }
    }

    if (!newCategory) {
      skipped++
      continue
    }

    await prisma.plantEntry.update({
      where: { id: plant.id },
      data: { category: newCategory },
    })
    updated++
  }

  console.log(`[recategorize-supplemental] Done! Re-categorized: ${updated} | Skipped: ${skipped}`)

  const counts = await prisma.$queryRaw`
    SELECT category, COUNT(*) as cnt
    FROM plant_entries
    WHERE category IN ('vegetable', 'fruit', 'herb', '')
       OR category IS NULL
    GROUP BY category
    ORDER BY cnt DESC
  `
  console.log('\nFinal category counts:')
  counts.forEach((row: any) => console.log(`  ${row.category ?? '(null)'}: ${Number(row.cnt)}`))

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[recategorize-supplemental] Fatal:', err)
  await prisma.$disconnect()
  process.exit(1)
})
