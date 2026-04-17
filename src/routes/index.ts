import type { FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './health.js';
import { registerAuthRoutes } from './auth.js';
import { registerBookRoutes } from './books.js';
import { registerSearchRoutes } from './search.js';
import { registerPlantRoutes } from './plants.js';
import { registerTaskRoutes } from './tasks.js';

export async function registerRoutes(app: FastifyInstance) {
  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerBookRoutes(app);
  await registerSearchRoutes(app);
  await registerPlantRoutes(app);
  await registerTaskRoutes(app);
}
