-- Reset empty companion/incompatible arrays to NULL so seed scripts can re-enrich
UPDATE "PlantEntry" SET "companionPlants" = NULL WHERE jsonb_array_length("companionPlants") = 0;
UPDATE "PlantEntry" SET "incompatiblePlants" = NULL WHERE jsonb_array_length("incompatiblePlants") = 0;