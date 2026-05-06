import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const count = await prisma.plantEntry.count();
console.log('Total plants:', count);
await prisma.$disconnect();