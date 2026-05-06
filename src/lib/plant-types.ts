// Shared types for plant import/export so the route and CSV helpers agree on structure

export interface PlantImport {
  commonName: string;
  scientificName?: string;
  variety?: string;
  family?: string;
  category?: string;
  sunlight?: string;
  waterNeeds?: string;
  soilType?: string;
  soilPh?: string;
  zoneMin?: number;
  zoneMax?: number;
  frostTolerance?: string;
  plantingDepth?: string;
  spacing?: string;
  daysToGermination?: number;
  daysToMaturity?: number;
  matureHeight?: string;
  matureSpread?: string;
  growthHabit?: string;
  perennialYears?: number | null;
  companionPlants?: string[];
  incompatiblePlants?: string[];
  commonPests?: string[];
  commonDiseases?: string[];
  harvestWindow?: string;
  harvestIndicators?: string;
  description?: string;
  careNotes?: string;
}

// Full plant row used for CSV export (arrays serialized to strings)
export interface PlantExportRow {
  commonName: string;
  scientificName?: string | null;
  variety?: string | null;
  family?: string | null;
  category?: string | null;
  sunlight?: string | null;
  waterNeeds?: string | null;
  soilType?: string | null;
  soilPh?: string | null;
  zoneMin?: number | null;
  zoneMax?: number | null;
  frostTolerance?: string | null;
  plantingDepth?: string | null;
  spacing?: string | null;
  daysToGermination?: number | null;
  daysToMaturity?: number | null;
  matureHeight?: string | null;
  matureSpread?: string | null;
  growthHabit?: string | null;
  perennialYears?: number | null;
  companionPlants?: string[] | null;
  incompatiblePlants?: string[] | null;
  commonPests?: string[] | null;
  commonDiseases?: string[] | null;
  harvestWindow?: string | null;
  harvestIndicators?: string | null;
  description?: string | null;
  careNotes?: string | null;
}
