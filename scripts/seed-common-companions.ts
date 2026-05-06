/**
 * Seed authoritative companion planting data for the most common garden plants.
 * Uses scientific name matching — updates ALL plants with a given scientific name.
 * Run: npx tsx scripts/seed-common-companions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Scientific name → { companions: common names, incompatible: common names }
// Sources: USDA, Cornell, university extension services
const SCI_COMPANIONS: Record<string, { companions: string[]; incompatible: string[] }> = {
  'Solanum lycopersicum': {
    companions: ['Basil', 'Carrot', 'Parsley', 'Marigold', 'Asparagus', 'Celery', 'Onion', 'Pepper'],
    incompatible: ['Fennel', 'Kohlrabi', 'Cabbage', 'Corn', 'Dill'],
  },
  'Solanum tuberosum': {
    companions: ['Bean', 'Corn', 'Cabbage', 'Horseradish', 'Marigold', 'Eggplant'],
    incompatible: ['Tomato', 'Cucumber', 'Pumpkin', 'Sunflower', 'Raspberry'],
  },
  'Daucus carota': {
    companions: ['Onion', 'Leek', 'Rosemary', 'Sage', 'Tomato', 'Lettuce', 'Chives', 'Bean'],
    incompatible: ['Dill', 'Fennel', 'Parsnip'],
  },
  'Lactuca sativa': {
    companions: ['Carrot', 'Radish', 'Strawberry', 'Chives', 'Garlic', 'Onion', 'Bean'],
    incompatible: ['Celery', 'Parsley'],
  },
  'Cucumis sativus': {
    companions: ['Bean', 'Corn', 'Pea', 'Radish', 'Sunflower', 'Lettuce', 'Marigold', 'Nasturtium'],
    incompatible: ['Potato', 'Sage', 'Melon', 'Fennel'],
  },
  'Capsicum annuum': {
    companions: ['Basil', 'Tomato', 'Carrot', 'Onion', 'Parsley', 'Spinach', 'Marjoram'],
    incompatible: ['Fennel', 'Kohlrabi'],
  },
  'Phaseolus vulgaris': {
    companions: ['Corn', 'Cucumber', 'Carrot', 'Cabbage', 'Cauliflower', 'Celery', 'Eggplant', 'Marigold', 'Strawberry'],
    incompatible: ['Onion', 'Garlic', 'Fennel', 'Leek', 'Pepper', 'Sunflower', 'Chives'],
  },
  'Pisum sativum': {
    companions: ['Carrot', 'Corn', 'Cucumber', 'Bean', 'Radish', 'Turnip', 'Mint', 'Marigold'],
    incompatible: ['Onion', 'Garlic', 'Leek', 'Chives', 'Fennel'],
  },
  'Zea mays': {
    companions: ['Bean', 'Pea', 'Cucumber', 'Melon', 'Pumpkin', 'Squash', 'Marigold', 'Sunflower'],
    incompatible: ['Tomato', 'Celery'],
  },
  'Spinacia oleracea': {
    companions: ['Bean', 'Cabbage', 'Cauliflower', 'Eggplant', 'Pea', 'Strawberry', 'Broccoli', 'Radish', 'Asparagus'],
    incompatible: ['Fennel'],
  },
  'Allium cepa': {
    companions: ['Beet', 'Cabbage', 'Carrot', 'Lettuce', 'Pepper', 'Strawberry', 'Tomato', 'Chamomile', 'Summer Savory'],
    incompatible: ['Bean', 'Pea', 'Sage', 'Asparagus'],
  },
  'Allium sativum': {
    companions: ['Beet', 'Cabbage', 'Carrot', 'Pepper', 'Strawberry', 'Tomato', 'Rose', 'Grape'],
    incompatible: ['Bean', 'Pea', 'Asparagus', 'Sage'],
  },
  'Ocimum basilicum': {
    companions: ['Tomato', 'Asparagus', 'Oregano', 'Pepper', 'Grape', 'Marigold'],
    incompatible: ['Fennel', 'Sage', 'Rue'],
  },
  'Brassica oleracea var. capitata': {
    companions: ['Bean', 'Celery', 'Onion', 'Beet', 'Kale', 'Lettuce', 'Marigold', 'Nasturtium', 'Radish', 'Thyme'],
    incompatible: ['Strawberry', 'Tomato', 'Pepper', 'Grape'],
  },
  'Brassica oleracea var. italica': {
    companions: ['Beet', 'Carrot', 'Celery', 'Onion', 'Kale', 'Lettuce', 'Radish', 'Spinach', 'Marigold', 'Nasturtium'],
    incompatible: ['Tomato', 'Strawberry', 'Pepper'],
  },
  'Brassica oleracea var. sabellica': {
    companions: ['Bean', 'Beet', 'Cabbage', 'Celery', 'Lettuce', 'Onion', 'Pea', 'Radish', 'Spinach', 'Thyme'],
    incompatible: ['Tomato', 'Strawberry', 'Grape'],
  },
  'Beta vulgaris': {
    companions: ['Cabbage', 'Bean', 'Lettuce', 'Onion', 'Kohlrabi', 'Broccoli', 'Kale'],
    incompatible: ['Bean (pole)', 'Charlock', 'Mustard'],
  },
  'Raphanus sativus': {
    companions: ['Carrot', 'Cucumber', 'Lettuce', 'Pea', 'Spinach', 'Squash', 'Strawberry', 'Tomato'],
    incompatible: ['Hyssop', 'Grape'],
  },
  'Solanum melongena': {
    companions: ['Bean', 'Pepper', 'Spinach', 'Tomato', 'Marigold', 'Thyme', 'Nasturtium'],
    incompatible: ['Fennel'],
  },
  'Cucurbita pepo': {
    companions: ['Bean', 'Corn', 'Melon', 'Nasturtium', 'Pea', 'Radish', 'Marigold', 'Borage'],
    incompatible: ['Potato'],
  },
  'Cucurbita maxima': {
    companions: ['Bean', 'Corn', 'Marigold', 'Melon', 'Nasturtium', 'Squash'],
    incompatible: ['Potato'],
  },
  'Cucumis melo': {
    companions: ['Bean', 'Corn', 'Marigold', 'Nasturtium', 'Pea', 'Radish', 'Squash', 'Borage'],
    incompatible: ['Potato', 'Sage'],
  },
  'Citrullus lanatus': {
    companions: ['Bean', 'Corn', 'Marigold', 'Nasturtium', 'Pea', 'Radish', 'Squash'],
    incompatible: ['Potato', 'Sage'],
  },
  'Apium graveolens var. dulce': {
    companions: ['Bean', 'Cabbage', 'Cauliflower', 'Leek', 'Lettuce', 'Pea', 'Tomato', 'Cucumber', 'Nasturtium'],
    incompatible: ['Carrot', 'Parsnip', 'Corn'],
  },
  'Asparagus officinalis': {
    companions: ['Basil', 'Carrot', 'Grape', 'Tomato', 'Parsley', 'Marigold', 'Nasturtium'],
    incompatible: ['Garlic', 'Onion', 'Potato'],
  },
  'Brassica oleracea var. botrytis': {
    companions: ['Bean', 'Beet', 'Broccoli', 'Cabbage', 'Celery', 'Onion', 'Spinach', 'Marigold'],
    incompatible: ['Strawberry', 'Tomato', 'Pepper'],
  },
  'Brassica oleracea var. gemmifera': {
    companions: ['Beet', 'Carrot', 'Onion', 'Sage', 'Thyme', 'Nasturtium', 'Marigold'],
    incompatible: ['Strawberry', 'Tomato'],
  },
  'Fragaria × ananassa': {
    companions: ['Bean', 'Borage', 'Carrot', 'Chives', 'Lettuce', 'Onion', 'Pea', 'Spinach', 'Thyme', 'Marigold'],
    incompatible: ['Cabbage', 'Cauliflower', 'Broccoli', 'Fennel'],
  },
  'Vitis vinifera': {
    companions: ['Basil', 'Bean', 'Chives', 'Clover', 'Corn', 'Oregano', 'Parsley', 'Rosemary', 'Sage', 'Hyssop'],
    incompatible: ['Cabbage', 'Celery', 'Cucumber', 'Garlic', 'Radish', 'Mint'],
  },
  'Malus domestica': {
    companions: ['Chives', 'Garlic', 'Horseradish', 'Nasturtium', 'Onion', 'Sage', 'Tansy'],
    incompatible: ['Grass', 'Walnut'],
  },
  'Prunus persica': {
    companions: ['Asparagus', 'Garlic', 'Nasturtium', 'Onion', 'Tansy', 'Chives'],
    incompatible: ['Grass', 'Walnut'],
  },
  'Prunus domestica': {
    companions: ['Garlic', 'Horseradish', 'Nasturtium', 'Onion', 'Chives'],
    incompatible: ['Grass', 'Walnut'],
  },
  'Prunus avium': {
    companions: ['Garlic', 'Horseradish', 'Nasturtium', 'Onion', 'Sage', 'Chives'],
    incompatible: ['Grass', 'Walnut'],
  },
  'Prunus armeniaca': {
    companions: ['Asparagus', 'Garlic', 'Nasturtium', 'Onion', 'Sage', 'Chives'],
    incompatible: ['Sage', 'Walnut', 'Grass'],
  },
  'Rubus idaeus': {
    companions: ['Bean', 'Cabbage', 'Grape', 'Marigold', 'Rue', 'Tansy', 'Thyme', 'Garlic'],
    incompatible: ['Potato', 'Blackberry', 'Elderberry', 'Tomato'],
  },
  'Vaccinium corymbosum': {
    companions: ['Borage', 'Clover', 'Mountain laurel', 'Pine', 'Strawberry'],
    incompatible: ['Plants needing alkaline soil', 'Walnut'],
  },
  'Juglans regia': {
    companions: [],
    incompatible: ['Apple', 'Pear', 'Plum', 'Cherry', 'Apricot', 'Potato', 'Tomato', 'Pepper', 'Eggplant', 'Grape', 'Raspberry'],
  },
  'Allium schoenoprasum': {
    companions: ['Cabbage', 'Carrot', 'Grape', 'Tomato', 'Rose', 'Apple', 'Broccoli'],
    incompatible: ['Bean', 'Pea', 'Asparagus'],
  },
  'Allium tuberosum': {
    companions: ['Cabbage', 'Carrot', 'Grape', 'Tomato', 'Rose', 'Apple'],
    incompatible: ['Bean', 'Pea', 'Asparagus'],
  },
  'Foeniculum vulgare': {
    companions: [],
    incompatible: ['Bean', 'Carrot', 'Cilantro', 'Dill', 'Kohlrabi', 'Pea', 'Tomato', 'Cucumber'],
  },
  'Anethum graveolens': {
    companions: ['Cabbage', 'Cucumber', 'Lettuce', 'Onion', 'Tomato'],
    incompatible: ['Carrot', 'Tomato (if left to bolt)', 'Fennel'],
  },
  'Petroselinum crispum': {
    companions: ['Asparagus', 'Carrot', 'Celery', 'Corn', 'Onion', 'Pepper', 'Tomato', 'Grape', 'Rose'],
    incompatible: ['Lettuce', 'Mint'],
  },
  'Coriandrum sativum': {
    companions: ['Bean', 'Pea', 'Spinach', 'Tomato', 'Pepper', 'Squash', 'Asparagus'],
    incompatible: ['Fennel', 'Dill (cross-pollination)'],
  },
  'Rosmarinus officinalis': {
    companions: ['Bean', 'Cabbage', 'Sage', 'Thyme', 'Lavender', 'Grape', 'Carrot'],
    incompatible: ['Cucumber', 'Pumpkin', 'Mint'],
  },
  'Thymus vulgaris': {
    companions: ['Cabbage', 'Eggplant', 'Potato', 'Strawberry', 'Tomato', 'Lavender', 'Rosemary'],
    incompatible: [],
  },
  'Mentha spicata': {
    companions: ['Cabbage', 'Tomato', 'Pea', 'Carrot'],
    incompatible: ['Chamomile', 'Parsley', 'Sage'],
  },
  'Origanum vulgare': {
    companions: ['Basil', 'Pepper', 'Tomato', 'Squash', 'Grape', 'Cucumber', 'Bean'],
    incompatible: [],
  },
  'Salvia officinalis': {
    companions: ['Cabbage', 'Carrot', 'Rosemary', 'Strawberry', 'Tomato', 'Lavender', 'Grape', 'Bean'],
    incompatible: ['Bean', 'Pea', 'Cucumber', 'Onion', 'Fennel'],
  },
  'Lavandula angustifolia': {
    companions: ['Sage', 'Thyme', 'Rosemary', 'Mint', 'Grape', 'Cabbage', 'Broccoli'],
    incompatible: [],
  },
  'Artemisia dracunculus': {
    companions: ['Asparagus', 'Carrot', 'Cucumber', 'Eggplant', 'Grape', 'Pepper', 'Tomato'],
    incompatible: ['Sage'],
  },
  'Satureja hortensis': {
    companions: ['Bean', 'Cabbage', 'Carrot', 'Cucumber', 'Lettuce', 'Onion', 'Pea', 'Tomato', 'Grape'],
    incompatible: ['Fennel'],
  },
  'Helianthus annuus': {
    companions: ['Bean', 'Corn', 'Cucumber', 'Melon', 'Pepper', 'Potato', 'Pumpkin', 'Squash', 'Tomato', 'Lettuce'],
    incompatible: ['Bean (pole)', 'Potato', 'Fennel'],
  },
  'Borago officinalis': {
    companions: ['Asparagus', 'Cabbage', 'Corn', 'Cucumber', 'Grape', 'Squash', 'Strawberry', 'Tomato', 'Melon'],
    incompatible: [],
  },
  'Tagetes patula': {
    companions: ['Asparagus', 'Bean', 'Cabbage', 'Cucumber', 'Eggplant', 'Melon', 'Pea', 'Pepper', 'Potato', 'Pumpkin', 'Squash', 'Strawberry', 'Tomato', 'Carrot'],
    incompatible: [],
  },
  'Tropaeolum majus': {
    companions: ['Apple', 'Bean', 'Cabbage', 'Cucumber', 'Grape', 'Pea', 'Pumpkin', 'Radish', 'Squash', 'Tomato', 'Raspberry'],
    incompatible: [],
  },
};

async function main() {
  console.log(`Seeding companion data for ${Object.keys(SCI_COMPANIONS).length} plants by scientific name...\n`);
  console.log('Updates ALL plants with each scientific name (all varieties)...\n');

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [sciName, data] of Object.entries(SCI_COMPANIONS)) {
    try {
      const result = await prisma.plantEntry.updateMany({
        where: {
          scientificName: { equals: sciName, mode: 'insensitive' },
          // Only update plants that don't have companion data yet
          OR: [
            { companionPlants: null },
          ],
        },
        data: {
          companionPlants: data.companions as any,
          incompatiblePlants: data.incompatible as any,
        },
      });

      if (result.count > 0) {
        updated += result.count;
        console.log(`  ✓ ${sciName}: ${result.count} plant(s) updated`);
      } else {
        // Check if any plants exist with this sciName
        const existing = await prisma.plantEntry.findMany({
          where: { scientificName: { equals: sciName, mode: 'insensitive' } },
          select: { commonName: true, companionPlants: true },
        });
        if (existing.length > 0) {
          console.log(`  – ${sciName}: ${existing.length} plant(s) already have data, skipping`);
          skipped++;
        } else {
          console.log(`  – ${sciName}: not found in DB`);
          skipped++;
        }
      }
    } catch (err: any) {
      console.error(`  [error] "${sciName}": ${err.message}`);
      errors++;
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Plants updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch(console.error);
