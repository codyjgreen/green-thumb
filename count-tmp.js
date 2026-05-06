const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.plantEntry.count().then(n => {
  console.log('Total plants:', n);
  prisma.$disconnect();
});
