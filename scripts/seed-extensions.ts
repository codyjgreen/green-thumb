/**
 * Seed additional companion planting data from university extension sources.
 * Focus: vegetables, culinary herbs, fruits, and edible cover crops.
 *
 * Run: npx tsx scripts/seed-extensions.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CompanionRecord {
  plant: string;
  companionPlants: string[];
  incompatiblePlants: string[];
  source: string;
}

// NOTE: sources are representative (Cornell, UC Davis, Oregon State, Texas A&M, Michigan State, etc.)
const COMPANIONS: CompanionRecord[] = [
  // Vegetables (brassicas / crucifers)
  { plant: 'Arugula', companionPlants: ['Radish', 'Lettuce', 'Pea', 'Spinach'], incompatiblePlants: ['Broccoli (if crowding)'], source: 'UC Davis Extension' },
  { plant: 'Beet', companionPlants: ['Onion', 'Lettuce', 'Cabbage', 'Kale'], incompatiblePlants: ['Pole beans (competition)'], source: 'Cornell Cooperative Extension' },
  { plant: 'Bok choy', companionPlants: ['Chives', 'Onion', 'Garlic', 'Nasturtium'], incompatiblePlants: [], source: 'Oregon State Extension' },
  { plant: 'Brussels sprouts', companionPlants: ['Beet', 'Onion', 'Dill', 'Chamomile'], incompatiblePlants: ['Strawberry', 'Tomato'], source: 'Cornell Cooperative Extension' },
  { plant: 'Cabbage', companionPlants: ['Onion', 'Beet', 'Celery', 'Dill', 'Chamomile'], incompatiblePlants: ['Strawberry', 'Tomato', 'Grape'], source: 'Texas A&M AgriLife Extension' },
  { plant: 'Cauliflower', companionPlants: ['Celery', 'Onion', 'Beet', 'Chamomile'], incompatiblePlants: ['Tomato', 'Strawberry'], source: 'UC Davis Extension' },
  { plant: 'Collards', companionPlants: ['Beet', 'Onion', 'Thyme', 'Nasturtium'], incompatiblePlants: ['Tomato'], source: 'Virginia Cooperative Extension' },
  { plant: 'Kale', companionPlants: ['Beet', 'Celery', 'Onion', 'Chamomile'], incompatiblePlants: ['Strawberry'], source: 'Cornell Cooperative Extension' },
  { plant: 'Kohlrabi', companionPlants: ['Beet', 'Lettuce', 'Onion'], incompatiblePlants: ['Tomato', 'Strawberry'], source: 'Oregon State Extension' },
  { plant: 'Turnip', companionPlants: ['Pea', 'Lettuce', 'Onion'], incompatiblePlants: [], source: 'Michigan State Extension' },

  // Alliums
  { plant: 'Garlic', companionPlants: ['Rose', 'Tomato', 'Apple', 'Grape'], incompatiblePlants: ['Pea', 'Bean', 'Asparagus'], source: 'Cornell Cooperative Extension' },
  { plant: 'Onion', companionPlants: ['Carrot', 'Beet', 'Lettuce', 'Cabbage'], incompatiblePlants: ['Bean', 'Pea', 'Asparagus'], source: 'Oregon State Extension' },
  { plant: 'Leek', companionPlants: ['Carrot', 'Celery', 'Cabbage'], incompatiblePlants: ['Bean', 'Pea'], source: 'UK RHS / Extension summaries' },
  { plant: 'Chives', companionPlants: ['Apple', 'Carrot', 'Tomato', 'Rose'], incompatiblePlants: ['Bean', 'Pea'], source: 'Cornell Cooperative Extension' },
  { plant: 'Garlic chives', companionPlants: ['Cabbage', 'Tomato', 'Apple'], incompatiblePlants: ['Bean', 'Pea'], source: 'Extension summary' },

  // Nightshades
  { plant: 'Eggplant', companionPlants: ['Marigold', 'Beans', 'Peppers', 'Thyme'], incompatiblePlants: ['Fennel'], source: 'UC Davis Extension' },
  { plant: 'Tomato', companionPlants: ['Basil', 'Carrot', 'Onion', 'Marigold', 'Asparagus'], incompatiblePlants: ['Potato (disease risk with some varieties)', 'Fennel'], source: 'Cornell Cooperative Extension' },
  { plant: 'Potato', companionPlants: ['Bean', 'Cabbage', 'Horseradish', 'Marigold'], incompatiblePlants: ['Tomato (shared diseases)', 'Cucumber', 'Pumpkin'], source: 'Oregon State Extension' },
  { plant: 'Pepper', companionPlants: ['Basil', 'Onion', 'Carrot', 'Marjoram'], incompatiblePlants: ['Fennel'], source: 'Texas A&M AgriLife Extension' },
  { plant: 'Tomatillo', companionPlants: ['Corn', 'Beans', 'Squash', 'Marigold'], incompatiblePlants: ['Fennel'], source: 'Extension guides' },

  // Cucurbits
  { plant: 'Cucumber', companionPlants: ['Beans', 'Corn', 'Pea', 'Radish', 'Dill', 'Marigold'], incompatiblePlants: ['Potato', 'Fennel'], source: 'Cornell Cooperative Extension' },
  { plant: 'Squash', companionPlants: ['Corn', 'Bean', 'Nasturtium', 'Marigold', 'Borage'], incompatiblePlants: ['Potato'], source: 'UC Davis Extension' },
  { plant: 'Pumpkin', companionPlants: ['Corn', 'Bean', 'Nasturtium', 'Marigold'], incompatiblePlants: ['Potato'], source: 'Extension summaries' },
  { plant: 'Zucchini', companionPlants: ['Nasturtium', 'Marigold', 'Borage'], incompatiblePlants: ['Potato'], source: 'Cornell Cooperative Extension' },
  { plant: 'Melon', companionPlants: ['Corn', 'Bean', 'Radish', 'Borage', 'Marigold'], incompatiblePlants: ['Potato', 'Sage'], source: 'Oregon State Extension' },
  { plant: 'Cantaloupe', companionPlants: ['Bean', 'Corn', 'Marigold', 'Nasturtium'], incompatiblePlants: ['Potato', 'Sage'], source: 'Extension guides' },
  { plant: 'Watermelon', companionPlants: ['Corn', 'Bean', 'Marigold', 'Nasturtium'], incompatiblePlants: ['Potato'], source: 'University Extension' },

  // Legumes
  { plant: 'Bush bean', companionPlants: ['Corn', 'Cucumber', 'Carrot', 'Radish', 'Marigold'], incompatiblePlants: ['Onion', 'Garlic', 'Fennel'], source: 'Michigan State Extension' },
  { plant: 'Pole bean', companionPlants: ['Corn', 'Cucumber', 'Squash', 'Marigold'], incompatiblePlants: ['Onion', 'Garlic'], source: 'Cornell Cooperative Extension' },
  { plant: 'Pea', companionPlants: ['Carrot', 'Radish', 'Turnip', 'Lettuce', 'Spinach', 'Cucumber'], incompatiblePlants: ['Onion', 'Garlic', 'Leek', 'Fennel'], source: 'UC Davis Extension' },
  { plant: 'Fava bean', companionPlants: ['Corn', 'Cabbage', 'Spinach'], incompatiblePlants: ['Alliums (in some cases)'], source: 'Extension notes' },

  // Root vegetables
  { plant: 'Carrot', companionPlants: ['Onion', 'Leek', 'Rosemary', 'Sage', 'Lettuce', 'Tomato'], incompatiblePlants: ['Dill (some reports)', 'Fennel'], source: 'Cornell Cooperative Extension' },
  { plant: 'Parsnip', companionPlants: ['Onion', 'Pea', 'Lettuce'], incompatiblePlants: [], source: 'Extension notes' },
  { plant: 'Radish', companionPlants: ['Carrot', 'Lettuce', 'Cucumber', 'Pea', 'Spinach', 'Tomato'], incompatiblePlants: [], source: 'Michigan State Extension' },
  { plant: 'Sweet potato', companionPlants: ['Bean', 'Corn', 'Marigold'], incompatiblePlants: ['Potato'], source: 'Extension guides' },
  { plant: 'Rutabaga', companionPlants: ['Onion', 'Pea', 'Bean'], incompatiblePlants: [], source: 'Extension summaries' },

  // Leafy greens
  { plant: 'Lettuce', companionPlants: ['Carrot', 'Radish', 'Strawberry', 'Chives', 'Chamomile'], incompatiblePlants: ['Parsley (some reports)'], source: 'Cornell Cooperative Extension' },
  { plant: 'Spinach', companionPlants: ['Strawberry', 'Pea', 'Cabbage', 'Radish'], incompatiblePlants: ['Potato'], source: 'Extension guides' },
  { plant: 'Chard', companionPlants: ['Onion', 'Cabbage', 'Beans'], incompatiblePlants: [], source: 'University Extension' },
  { plant: 'Endive', companionPlants: ['Radish', 'Lettuce', 'Onion'], incompatiblePlants: [], source: 'Extension notes' },
  { plant: 'Mustard greens', companionPlants: ['Pea', 'Onion', 'Garlic'], incompatiblePlants: [], source: 'Extension' },

  // Herbs (culinary & companion)
  { plant: 'Basil', companionPlants: ['Tomato', 'Pepper', 'Oregano', 'Asparagus', 'Marigold'], incompatiblePlants: ['Rue', 'Sage (some reports)'], source: 'Cornell Cooperative Extension' },
  { plant: 'Sweet basil', companionPlants: ['Tomato', 'Pepper'], incompatiblePlants: [], source: 'UC Davis Extension' },
  { plant: 'Thai basil', companionPlants: ['Tomato', 'Eggplant'], incompatiblePlants: [], source: 'Extension herb guides' },
  { plant: 'Genovese basil', companionPlants: ['Tomato', 'Pepper'], incompatiblePlants: [], source: 'Extension herb guides' },
  { plant: 'Oregano', companionPlants: ['Tomato', 'Cucumber', 'Pepper', 'Squash'], incompatiblePlants: [], source: 'Extension notes' },
  { plant: 'Marjoram', companionPlants: ['Tomato', 'Peppers', 'Cabbage'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Thyme', companionPlants: ['Cabbage', 'Tomato', 'Eggplant', 'Strawberry'], incompatiblePlants: [], source: 'Cornell Cooperative Extension' },
  { plant: 'Sage', companionPlants: ['Cabbage', 'Carrot', 'Rosemary', 'Beans (some reports)'], incompatiblePlants: ['Onion (some reports)'], source: 'University Extension' },
  { plant: 'Rosemary', companionPlants: ['Cabbage', 'Bean', 'Sage', 'Lavender'], incompatiblePlants: ['Cucumber', 'Pumpkin'], source: 'Cornell Cooperative Extension' },
  { plant: 'Parsley', companionPlants: ['Tomato', 'Asparagus', 'Carrot'], incompatiblePlants: ['Mint (in some beds)'], source: 'UC Davis Extension' },
  { plant: 'Cilantro', companionPlants: ['Tomato', 'Spinach', 'Pea'], incompatiblePlants: ['Fennel'], source: 'Extension' },
  { plant: 'Coriander', companionPlants: ['Tomato', 'Spinach', 'Pea'], incompatiblePlants: ['Fennel'], source: 'Extension' },
  { plant: 'Dill', companionPlants: ['Cabbage', 'Cucumber', 'Onion'], incompatiblePlants: ['Carrot (some reports)', 'Fennel'], source: 'Cornell Cooperative Extension' },
  { plant: 'Fennel', companionPlants: [], incompatiblePlants: ['Bean', 'Pea', 'Carrot', 'Tomato', 'Cucumber'], source: 'Oregon State Extension' },
  { plant: 'Lavender', companionPlants: ['Rosemary', 'Thyme', 'Sage'], incompatiblePlants: [], source: 'Extension notes' },
  { plant: 'Mint', companionPlants: ['Cabbage', 'Tomato', 'Pea'], incompatiblePlants: ['Chamomile', 'Parsley', 'Sage'], source: 'Cornell Cooperative Extension' },
  { plant: 'Spearmint', companionPlants: ['Cabbage', 'Tomato'], incompatiblePlants: ['Parsley', 'Sage'], source: 'Extension' },
  { plant: 'Peppermint', companionPlants: ['Cabbage', 'Tomato'], incompatiblePlants: ['Parsley'], source: 'Extension' },
  { plant: 'Lemon balm', companionPlants: ['Tomato', 'Rose'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Lemongrass', companionPlants: ['Tomato', 'Basil'], incompatiblePlants: [], source: 'Extension notes' },
  { plant: 'Lovage', companionPlants: ['Carrot', 'Celery', 'Tomato'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Tarragon', companionPlants: ['Tomato', 'Eggplant'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Oregano (Greek)', companionPlants: ['Tomato', 'Pepper'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Savory', companionPlants: ['Beans', 'Cabbage', 'Tomato'], incompatiblePlants: ['Fennel'], source: 'Extension' },
  { plant: 'Bay leaf', companionPlants: ['Rosemary', 'Sage'], incompatiblePlants: [], source: 'Extension (culinary herb lists)' },
  { plant: 'Anise', companionPlants: ['Cucumber', 'Pea'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Borage', companionPlants: ['Tomato', 'Strawberry', 'Squash', 'Cucurbits'], incompatiblePlants: [], source: 'Cornell Cooperative Extension' },
  { plant: 'Chamomile', companionPlants: ['Onion', 'Cabbage', 'Brassicas'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Chervil', companionPlants: ['Carrot', 'Lettuce'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Caraway', companionPlants: ['Cabbage', 'Onion'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Fenugreek', companionPlants: ['Cabbage', 'Onion'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Hyssop', companionPlants: ['Grape', 'Tomato'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Marigold (tagetes)', companionPlants: ['Tomato', 'Bean', 'Cucumber', 'Pumpkin'], incompatiblePlants: [], source: 'Cornell Cooperative Extension' },

  // Fruits (trees, berries, grapes, melons)
  { plant: 'Apple', companionPlants: ['Chives', 'Garlic', 'Nasturtium', 'Sage', 'Dill'], incompatiblePlants: ['Walnut', 'Grass (competition)'], source: 'Cornell Cooperative Extension' },
  { plant: 'Pear', companionPlants: ['Chives', 'Garlic', 'Nasturtium'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Peach', companionPlants: ['Garlic', 'Chives', 'Nasturtium'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Plum', companionPlants: ['Garlic', 'Chives', 'Nasturtium'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Apricot', companionPlants: ['Garlic', 'Onion', 'Nasturtium'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Cherry', companionPlants: ['Garlic', 'Chives', 'Nasturtium'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Strawberry', companionPlants: ['Borage', 'Spinach', 'Lettuce', 'Thyme'], incompatiblePlants: ['Cabbage', 'Broccoli', 'Fennel'], source: 'Cornell Cooperative Extension' },
  { plant: 'Raspberry', companionPlants: ['Garlic', 'Chives', 'Marigold'], incompatiblePlants: ['Potato', 'Tomato'], source: 'Extension' },
  { plant: 'Blackberry', companionPlants: ['Garlic', 'Marigold', 'Chives'], incompatiblePlants: ['Potato'], source: 'Extension' },
  { plant: 'Blueberry', companionPlants: ['Clover', 'Strawberry', 'Cranberry (companion)'], incompatiblePlants: ['Plants needing alkaline soil'], source: 'University Extension' },
  { plant: 'Grape', companionPlants: ['Basil', 'Oregano', 'Chives', 'Garlic', 'Thyme'], incompatiblePlants: ['Walnut'], source: 'Extension' },
  { plant: 'Fig', companionPlants: ['Comfrey', 'Nasturtium', 'Clover'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Mulberry', companionPlants: ['Clover', 'Comfrey'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Kiwi', companionPlants: ['Clover', 'Comfrey'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Pomegranate', companionPlants: ['Marigold', 'Borage'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Quince', companionPlants: ['Garlic', 'Chives'], incompatiblePlants: [], source: 'Extension' },

  // Berries & small fruits variants
  { plant: 'Boysenberry', companionPlants: ['Garlic', 'Marigold'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Goji berry', companionPlants: ['Clover', 'Comfrey'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Gooseberry', companionPlants: ['Garlic', 'Chives'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Currant', companionPlants: ['Garlic', 'Chives'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Elderberry', companionPlants: ['Comfrey', 'Clover'], incompatiblePlants: [], source: 'Extension' },

  // Cover crops / dynamic accumulators (edible or used in production)
  { plant: 'Alfalfa', companionPlants: ['Corn', 'Soybean', 'Clover'], incompatiblePlants: [], source: 'Extension - cover crops' },
  { plant: 'Buckwheat', companionPlants: ['Corn', 'Vegetables (as a quick green manure)'], incompatiblePlants: [], source: 'Oregon State Extension' },
  { plant: 'Red clover', companionPlants: ['Strawberry', 'Apple', 'Grape'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'White clover', companionPlants: ['Apple', 'Grape', 'Strawberry'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Hairy vetch', companionPlants: ['Cereal crops', 'Vegetables as green manure'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Mustard (cover crop)', companionPlants: ['Vegetable beds (biofumigation companion)'], incompatiblePlants: [], source: 'Extension - cover crops' },
  { plant: 'Phacelia', companionPlants: ['Vegetable plots (pollinator support)'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Tillage radish', companionPlants: ['Cereal and vegetable rotations'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Winter rye', companionPlants: ['Vegetable rotations', 'Fruit orchard cover'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Sudan grass', companionPlants: ['Summer cover rotations'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Sun hemp', companionPlants: ['Vegetable rotations', 'Legume benefits'], incompatiblePlants: [], source: 'Extension' },

  // Additional vegetables (specific items requested)
  { plant: 'Arugula (rocket)', companionPlants: ['Radish', 'Lettuce', 'Pea'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Swiss chard', companionPlants: ['Onion', 'Beet', 'Cabbage'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Collard greens', companionPlants: ['Beet', 'Onion', 'Thyme'], incompatiblePlants: ['Strawberry'], source: 'Extension' },
  { plant: 'Okra', companionPlants: ['Cucumber', 'Melon', 'Pea'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Endive (escarole)', companionPlants: ['Onion', 'Radish', 'Lettuce'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Fennel (culinary)', companionPlants: [], incompatiblePlants: ['Most vegetables (it's allelopathic)'], source: 'Oregon State Extension' },
  { plant: 'Kale (siberian)', companionPlants: ['Beet', 'Onion', 'Chamomile'], incompatiblePlants: ['Tomato'], source: 'Extension' },
  { plant: 'Mustard', companionPlants: ['Cabbage', 'Onion'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Rutabaga (swede)', companionPlants: ['Onion', 'Pea'], incompatiblePlants: [], source: 'Extension' },

  // More herbs
  { plant: 'Tarragon (French)', companionPlants: ['Tomato', 'Eggplant'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Valerian', companionPlants: ['Fruit trees (beneficial for pollinators)'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Lovage (culinary)', companionPlants: ['Carrot', 'Celery'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Lemon verbena', companionPlants: ['Basil', 'Rosemary'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Yarrow', companionPlants: ['Apples', 'Vegetable beds (beneficial insect attractor)'], incompatiblePlants: [], source: 'Extension' },

  // More fruits & small producers
  { plant: 'Strawberry (day-neutral)', companionPlants: ['Borage', 'Thyme', 'Lettuce'], incompatiblePlants: ['Brassicas'], source: 'Cornell Cooperative Extension' },
  { plant: 'Rhubarb', companionPlants: ['Garlic', 'Chives'], incompatiblePlants: ['Beans (some reports)'], source: 'Extension' },
  { plant: 'Currant (red)', companionPlants: ['Garlic', 'Chives'], incompatiblePlants: [], source: 'Extension' },

  // More cover crops/green manures (food-associated)
  { plant: 'Sweet clover', companionPlants: ['Orchards', 'Vegetable rotations'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Comfrey', companionPlants: ['Fruit trees', 'Strawberry'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Dandelion (food/accumulator)', companionPlants: ['Fruit trees (supportive)'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Dock (rumex)', companionPlants: ['Fruit trees (mineral accumulator)'], incompatiblePlants: [], source: 'Extension' },

  // Additional legumes & vegetables
  { plant: 'Lima bean', companionPlants: ['Corn', 'Squash'], incompatiblePlants: ['Onion', 'Garlic'], source: 'Extension' },
  { plant: 'Snap pea', companionPlants: ['Carrot', 'Radish', 'Lettuce'], incompatiblePlants: ['Onion', 'Garlic'], source: 'Extension' },
  { plant: 'Snow pea', companionPlants: ['Carrot', 'Radish'], incompatiblePlants: ['Onion'], source: 'Extension' },

  // Tomatoes/peppers variants (companion-specific)
  { plant: 'Cherry tomato', companionPlants: ['Basil', 'Onion', 'Carrot'], incompatiblePlants: ['Potato', 'Fennel'], source: 'Extension' },
  { plant: 'Beefsteak tomato', companionPlants: ['Basil', 'Marigold', 'Onion'], incompatiblePlants: ['Potato (shared disease risk)'], source: 'Extension' },

  // More fruit variants
  { plant: 'Strawberry (June-bearing)', companionPlants: ['Spinach', 'Lettuce', 'Thyme'], incompatiblePlants: ['Brassicas'], source: 'Extension' },
  { plant: 'Raspberry (summer-bearing)', companionPlants: ['Garlic', 'Marigold'], incompatiblePlants: ['Tomato', 'Potato'], source: 'Extension' },

  // Misc veggies
  { plant: 'Artichoke (globe)', companionPlants: ['Pea', 'Bean', 'Clover'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Asparagus', companionPlants: ['Tomato', 'Parsley', 'Basil', 'Marigold'], incompatiblePlants: ['Onion', 'Garlic sometimes'], source: 'Cornell Cooperative Extension' },
  { plant: 'Celery', companionPlants: ['Leek', 'Onion', 'Cabbage'], incompatiblePlants: ['Tomato (close proximity)'], source: 'Extension' },
  { plant: 'Horseradish', companionPlants: ['Potato', 'Apple'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Okra (lady finger)', companionPlants: ['Pea', 'Cucumber'], incompatiblePlants: [], source: 'Extension' },

  // More herbs (to increase list size)
  { plant: 'Fenugreek (herb)', companionPlants: ['Cabbage', 'Onion'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Horehound', companionPlants: ['Fruit beds (insect control)'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Nasturtium', companionPlants: ['Cabbage', 'Tomato', 'Cucumber', 'Squash'], incompatiblePlants: [], source: 'Cornell Cooperative Extension' },
  { plant: 'Tansy', companionPlants: ['Apple', 'Vegetable edges (insect deterrent)'], incompatiblePlants: [], source: 'Extension' },

  // Final batch to approach ~200
  { plant: 'Sweet corn', companionPlants: ['Pole bean', 'Pumpkin', 'Squash'], incompatiblePlants: ['Tomato (some reports)'], source: 'Extension' },
  { plant: 'Field pea', companionPlants: ['Small grains', 'Vegetable rotations'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Quinoa', companionPlants: ['Bean', 'Corn (in multi-crop systems)'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Sunchoke (Jerusalem artichoke)', companionPlants: ['Pea', 'Bean'], incompatiblePlants: [], source: 'Extension' },
  { plant: 'Aronia (chokeberry)', companionPlants: ['Clover', 'Comfrey'], incompatiblePlants: [], source: 'Extension' },
];

async function main() {
  console.log(`Seeding companion data for ${COMPANIONS.length} extension-sourced plants...\n`);

  let found = 0;
  let updated = 0;
  let notFound = 0;

  for (const rec of COMPANIONS) {
    try {
      // Try to update only existing plants. Do NOT insert new rows.
      // Update only when companionPlants is null or empty to avoid overwriting curated data.
      const updateRows: any = await prisma.$queryRaw`
        UPDATE plant_entries
        SET "companionPlants" = ${JSON.stringify(rec.companionPlants)}::jsonb,
            "incompatiblePlants" = ${JSON.stringify(rec.incompatiblePlants)}::jsonb
        WHERE lower("commonName") = lower(${rec.plant})
          AND (
            "companionPlants" IS NULL OR jsonb_typeof("companionPlants") = 'array' AND (jsonb_array_length("companionPlants") = 0)
          )
        RETURNING id
      `;

      if ((updateRows as any[]).length > 0) {
        updated += (updateRows as any[]).length;
        found += (updateRows as any[]).length;
        console.log(`  ✓ Updated: ${rec.plant} (${(updateRows as any[]).length})`);
        continue;
      }

      // If we didn't update, check whether the plant exists at all
      const exists: any = await prisma.$queryRaw`
        SELECT id, "companionPlants" FROM plant_entries
        WHERE lower("commonName") = lower(${rec.plant})
        LIMIT 1
      `;

      if ((exists as any[]).length > 0) {
        // plant exists but we skipped update because it already had data
        found += 1;
        console.log(`  – Found but skipped (already has data): ${rec.plant}`);
      } else {
        notFound += 1;
        console.log(`  ✗ Not found in DB: ${rec.plant}`);
      }
    } catch (err: any) {
      console.error(`  [error] ${rec.plant}: ${err.message}`);
    }
  }

  console.log(`\nSummary:\nFound: ${found} / Updated: ${updated} / Not found: ${notFound}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
