-- Add comprehensive fields to plant_entries for rich gardening knowledge
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "sunlight" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "water_needs" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "soil_type" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "soil_ph" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "zone_min" INTEGER;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "zone_max" INTEGER;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "frost_tolerance" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "planting_depth" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "spacing" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "days_to_germination" INTEGER;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "days_to_maturity" INTEGER;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "mature_height" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "mature_spread" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "growth_habit" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "perennial_years" INTEGER;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "companion_plants" JSONB;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "incompatible_plants" JSONB;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "common_pests" JSONB;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "common_diseases" JSONB;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "harvest_window" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "harvest_indicators" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "care_notes" TEXT;
ALTER TABLE "plant_entries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS "plant_entries_category_idx" ON "plant_entries" ("category");

-- Index for scientific name lookups
CREATE INDEX IF NOT EXISTS "plant_entries_scientific_name_idx" ON "plant_entries" ("scientificName");
