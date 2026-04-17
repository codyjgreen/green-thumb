import { loadEnvFile } from './lib/env.js';
import { loadConfig } from './lib/config.js';
import { prisma } from './lib/db.server.js';

loadEnvFile();
loadConfig();

async function seed() {
  console.log('Seeding database...');

  // Create a demo user
  const { hash } = await import('bcrypt');
  const hashedPassword = await hash('demo-password-123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@greenthumb.local' },
    update: {},
    create: {
      email: 'demo@greenthumb.local',
      password: hashedPassword,
    },
  });

  console.log(`Created demo user: ${user.email}`);
  console.log('Password: demo-password-123');

  await prisma.$disconnect();
  console.log('Done.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
