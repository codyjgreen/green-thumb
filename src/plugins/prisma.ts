import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.server.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

async function prismaPlugin(app: FastifyInstance) {
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await app.prisma.$disconnect();
  });
}

export default fp(prismaPlugin, { name: 'prisma' });
