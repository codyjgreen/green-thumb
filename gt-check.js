const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
async function check() {
  await client.$connect();
  const total = await client.plant.count();
  const fruit = await client.plant.count({ where: { category: 'fruit' } });
  const veg = await client.plant.count({ where: { category: 'vegetable' } });
  const herb = await client.plant.count({ where: { category: 'herb' } });
  const varieties = await client.plant.count({ where: { NOT: { variety: '' } } });
  const withCompanions = await client.plant.count({ where: { companionPlants: { isEmpty: false } } });
  console.log('Total:', total, '| Fruit:', fruit, '| Veg:', veg, '| Herb:', herb);
  console.log('Varieties:', varieties, '| With companions:', withCompanions);
  const fig = await client.plant.findFirst({ 
    where: { commonName: { contains: 'fig', mode: 'insensitive' } },
    select: { commonName: true, scientificName: true, variety: true, category: true, chillHoursMin: true, pollinationType: true }
  });
  console.log('Fig entry:', JSON.stringify(fig));
  await client.$disconnect();
}
check().catch(e => console.error(e.message));
