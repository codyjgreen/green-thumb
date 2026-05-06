/**
 * Re-categorize null-category plants that belong to known edible plant families.
 *
 * The USDA import left 4,134 records with category=null. Many are ornamental trees
 * and shrubs, but some are edible plants whose category simply wasn't derived.
 *
 * Strategy: Check scientificName/family against known edible plant families.
 * Only re-categorize if there's a strong signal it's food-related.
 *
 * Run: cd green-thumb && ./node_modules/.bin/tsx scripts/recategorize-edibles.ts
 */

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

// ── Known edible families ────────────────────────────────────────────────────
// Families that contain significant edible food crops
const EDIBLE_FAMILIES = new Set([
  // ── Fruits ──────────────────────────────────────────────────────────────
  'Rosaceae',           // apples, pears, plums, peaches, cherries, almonds, strawberries
  'Moraceae',           // figs, mulberries
  'Vitaceae',           // grapes
  'Ericaceae',          // blueberries, cranberries, huckleberries
  'Grossulariaceae',    // gooseberries, currants
  'Rubiaceae',          // coffee
  'Actinidiaceae',      // kiwi
  'Musaceae',           // bananas
  'Caricaceae',         // papaya
  'Anacardiaceae',      // mangoes, pistachios
  'Sapindaceae',        // lychee, rambutan
  'Myrtaceae',          // guava, feijoa, allspice
  ' Rutaceae',          // citrus (trimmed space later)
  'Lauraceae',          // avocado, bay
  'Bombacaceae',        // durian
  'Cactaceae',          // prickly pear / cactus fruits
  'Passifloraceae',     // passion fruit
  'Oleaceae',           // olives

  // ── Vegetables & Culinary Herbs ─────────────────────────────────────────
  'Solanaceae',         // tomatoes, potatoes, peppers, eggplant
  'Brassicaceae',       // cabbage, broccoli, kale, cauliflower, mustard, radish
  'Cucurbitaceae',      // cucumbers, squash, melons, pumpkins, gourds
  'Fabaceae',           // beans, peas, lentils, peanuts, clover
  'Amaranthaceae',      // spinach, chard, quinoa, beets
  'Amaryllidaceae',     // onions, garlic, leeks, chives, shallots
  'Apiaceae',           // carrots, celery, parsley, dill, fennel, coriander
  'Lamiaceae',          // basil, mint, rosemary, sage, thyme, oregano, lavender
  'Asteraceae',        // lettuce, artichoke, sunflower, endive, chicory
  'Poaceae',            // corn, wheat, rice, oats, barley, bamboo shoots
  'Polygonaceae',       // rhubarb
  'Chenopodiaceae',     // (legacy name for Amaranthaceae) beets, chard
  'Caryophyllaceae',   // carnation / chive (edible flowers)
  'Crassulaceae',       // (some sedums are edible)
  ' Tropaeolaceae',     // nasturtium

  // ── Nuts & Seeds ────────────────────────────────────────────────────────
  'Juglandaceae',       // walnuts, pecans
  'Fagaceae',           // chestnuts
  'Anacardiaceae',      // pistachios (already listed above)
  'Corylaceae',         // hazelnuts
  'Proteaceae',         // macadamia
])

// Clean up any accidental leading/trailing spaces
EDIBLE_FAMILIES.forEach(f => f.trim())

// Also do a keyword check on commonName for extra coverage
const EDIBLE_KEYWORDS = [
  // Fruits
  'apple', 'pear', 'plum', 'peach', 'nectarine', 'cherry', 'apricot',
  'fig', 'grape', 'berry', 'blueberry', 'raspberry', 'blackberry',
  'strawberry', 'cranberry', 'currant', 'gooseberry', 'elderberry',
  'mulberry', 'pomegranate', 'citrus', 'orange', 'lemon', 'lime',
  'grapefruit', 'tangerine', 'kumquat', 'kiwi', 'mango', 'papaya',
  'guava', 'passion fruit', 'avocado', 'olive', 'date', 'lychee',
  'banana', 'pineapple', 'melon', 'watermelon', 'cantaloupe',
  'honeydew', 'persimmon', 'quince', 'medlar', 'serviceberry',
  // Vegetables
  'tomato', 'pepper', 'eggplant', 'potato', 'sweet potato', 'yam',
  'cucumber', 'squash', 'zucchini', 'pumpkin', 'gourd', 'melon',
  'cabbage', 'broccoli', 'cauliflower', 'kale', 'brussels sprout',
  'radish', 'turnip', 'rutabaga', 'mustard', 'arugula', 'bok choy',
  'lettuce', 'spinach', 'chard', 'collard', 'chicory', 'endive',
  'artichoke', 'sunflower', 'sunchoke', 'jerusalem artichoke',
  'carrot', 'celery', 'parsnip', 'fennel', 'parsley', 'coriander',
  'dill', 'cilantro', 'basil', 'thyme', 'sage', 'rosemary', 'oregano',
  'mint', 'lavender', 'tarragon', 'chive', 'leek', 'garlic', 'onion',
  'shallot', 'scallion', 'asparagus', 'rhubarb', 'okra',
  'bean', 'pea', 'lentil', 'chickpea', 'peanut', 'soybean',
  'corn', 'wheat', 'rice', 'oat', 'barley', 'quinoa', 'amaranth',
  'radicchio', 'sorrel', 'watercress', 'kohlrabi', 'swiss chard',
  // Nuts
  'walnut', 'pecan', 'hazelnut', 'chestnut', 'almond', 'pistachio',
  'macadamia', 'cashew',
]

/**
 * Determine if a plant is likely edible based on family + commonName keywords.
 * Returns: 'fruit' | 'vegetable' | 'herb' | null
 */
function inferCategory(
  family: string | null,
  commonName: string,
  scientificName: string
): 'fruit' | 'vegetable' | 'herb' | null {
  const cnLower = commonName.toLowerCase()
  const snLower = scientificName.toLowerCase()
  const familyLower = (family ?? '').toLowerCase()

  // Check family first
  let familyMatch = false
  for (const fam of EDIBLE_FAMILIES) {
    if (familyLower.includes(fam.toLowerCase())) { familyMatch = true; break }
  }

  // Check keywords
  let keywordMatch = false
  let keyword = ''
  for (const kw of EDIBLE_KEYWORDS) {
    if (cnLower.includes(kw) || snLower.includes(kw)) {
      keywordMatch = true
      keyword = kw
      break
    }
  }

  if (!familyMatch && !keywordMatch) return null

  // Categorize based on keyword or family
  const FRUIT_KW = ['apple','pear','plum','peach','nectarine','cherry','apricot','fig','grape','berry','blueberry','raspberry','blackberry','strawberry','cranberry','currant','gooseberry','elderberry','mulberry','pomegranate','citrus','orange','lemon','lime','grapefruit','tangerine','kumquat','kiwi','mango','papaya','guava','passion fruit','avocado','olive','date','lychee','banana','pineapple','melon','watermelon','cantaloupe','honeydew','persimmon','quince','medlar','walnut','pecan','hazelnut','chestnut','almond','pistachio','macadamia','cashew']
  const HERB_KW = ['basil','thyme','sage','rosemary','oregano','mint','lavender','tarragon','chive','dill','cilantro','parsley','fennel','coriander','anise','caraway','lovage','marjoram','hyssop',' savory','sage']
  const VEG_KW = ['tomato','pepper','eggplant','potato','sweet potato','yam','cucumber','squash','zucchini','pumpkin','gourd','cabbage','broccoli','cauliflower','kale','brussels sprout','radish','turnip','rutabaga','mustard','arugula','bok choy','lettuce','spinach','chard','collard','chicory','endive','artichoke','sunflower','sunchoke','jerusalem artichoke','carrot','celery','parsnip','parsley','fennel','celery','parsnip','asparagus','rhubarb','okra','bean','pea','lentil','chickpea','peanut','soybean','corn','wheat','rice','oat','barley','quinoa','amaranth','radicchio','sorrel','watercress','kohlrabi','swiss chard','leek','garlic','onion','shallot','scallion']

  for (const kw of FRUIT_KW) {
    if (cnLower.includes(kw) || snLower.includes(kw)) return 'fruit'
  }
  for (const kw of HERB_KW) {
    if (cnLower.includes(kw) || snLower.includes(kw)) return 'herb'
  }
  for (const kw of VEG_KW) {
    if (cnLower.includes(kw) || snLower.includes(kw)) return 'vegetable'
  }

  // Fallback: use family to guess
  const FRUIT_FAMILIES = ['Rosaceae','Moraceae','Vitaceae','Ericaceae','Grossulariaceae','Caricaceae','Actinidiaceae','Musaceae','Anacardiaceae','Sapindaceae','Myrtaceae','Lauraceae','Bombacaceae','Cactaceae','Passifloraceae','Oleaceae','Juglandaceae','Fagaceae','Corylaceae','Proteaceae']
  if (FRUIT_FAMILIES.some(f => familyLower.includes(f.toLowerCase()))) return 'fruit'

  // Herbs are mostly Lamiaceae
  if (familyLower.includes('lamiaceae')) return 'herb'

  return 'vegetable' // Default edible to vegetable if unsure
}

async function main() {
  console.log('[recategorize-edibles] Starting re-categorization...\n')

  // Find all null-category records
  const nullCategory = await prisma.plantEntry.findMany({
    where: {
      OR: [
        { category: null },
        { category: '' },
      ],
    },
    select: {
      id: true,
      commonName: true,
      scientificName: true,
      family: true,
      category: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`[recategorize-edibles] Found ${nullCategory.length} null/empty category records\n`)

  let updated = 0
  let skipped = 0
  let batch = 0

  for (const plant of nullCategory) {
    const newCategory = inferCategory(plant.family, plant.commonName, plant.scientificName ?? '')

    if (!newCategory) {
      skipped++
      continue
    }

    await prisma.plantEntry.update({
      where: { id: plant.id },
      data: { category: newCategory },
    })
    updated++
    batch++

    if (batch % 100 === 0) {
      console.log(`  Processed ${batch}/${nullCategory.length} | re-categorized: ${updated} | skipped: ${skipped}`)
    }
  }

  console.log(`\n[recategorize-edibles] Done!`)
  console.log(`  Re-categorized: ${updated}`)
  console.log(`  Skipped (no edible signal): ${skipped}`)

  // Final count
  const counts = await prisma.$queryRaw`
    SELECT category, COUNT(*) as cnt
    FROM plant_entries
    WHERE category IN ('vegetable', 'fruit', 'herb', '')
    GROUP BY category
    ORDER BY cnt DESC
  `
  console.log('\n[recategorize-edibles] Final counts:')
  counts.forEach((row: any) => console.log(`  ${row.category ?? '(null)'}: ${Number(row.cnt)}`))

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('[recategorize-edibles] Fatal:', err)
  await prisma.$disconnect()
  process.exit(1)
})
