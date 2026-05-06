import type { PrismaClient, PlantVersion } from '@prisma/client';
import type { PlantEntry } from '@prisma/client';
import type { InputJsonValue } from '@prisma/client/runtime/library';

// Deep-diff two plant objects and return what changed
export function diffPlants(before: Partial<PlantEntry>, after: Partial<PlantEntry>): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  const fields = Object.keys(after) as (keyof PlantEntry)[];
  for (const field of fields) {
    const oldVal = before[field];
    if (oldVal === undefined) continue;
    const newVal = after[field];
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);
    if (oldStr !== newStr) {
      changes[field as string] = [oldVal, newVal];
    }
  }
  return changes;
}

// Record a version after a plant create/update
export async function recordVersion(
  prisma: PrismaClient,
  plantId: string,
  before: Partial<PlantEntry> | null,  // null on create
  after: Partial<PlantEntry>,
  changedBy?: string
): Promise<void> {
  const version = after.currentVersion ?? 1;
  const changes = (before ? diffPlants(before, after) : { __created: [null, null] }) as InputJsonValue;

  await prisma.plantVersion.create({
    data: {
      plantId,
      version,
      changes,
      changedBy: changedBy ?? null,
    },
  });
}
