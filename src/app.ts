import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { resolve } from 'node:path';
import errorHandlerPlugin from './plugins/error-handler.js';
import jwtPlugin from './plugins/jwt.js';
import prismaPlugin from './plugins/prisma.js';
import { registerRoutes } from './routes/index.js';

import type { AppConfig } from './lib/config.js';

declare module 'fastify' {
  interface FastifyInstance {
    uploadsDir: string;
    config: AppConfig;
  }
}

export function buildApp(config: AppConfig) {
  const uploadsDir = resolve(process.cwd(), config.UPLOADS_DIR);

  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
  });

  app.decorate('uploadsDir', uploadsDir);
  app.decorate('config', config);

  // CORS — open for any consuming app
  app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // File uploads (10MB limit)
  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // Serve uploaded files at /uploads/
  app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
  });

  // OpenAPI documentation
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Green-Thumb API',
        description: 'Gardening knowledge RAG API — ingest books, search plants, extract growing tips and tasks.',
        version: '0.1.0',
      },
      servers: [
        { url: 'http://localhost:3002', description: 'Local development' },
      ],
      tags: [
        { name: 'books', description: 'Book ingestion and management' },
        { name: 'search', description: 'Semantic search across book knowledge' },
        { name: 'plants', description: 'Structured plant information' },
        { name: 'tasks', description: 'Gardening tasks extracted from books' },
        { name: 'auth', description: 'Authentication' },
      ],
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      filter: true,
    },
  });

  app.setErrorHandler(errorHandlerPlugin);
  app.register(jwtPlugin, { accessSecret: config.JWT_ACCESS_SECRET });
  app.register(prismaPlugin);

  // Root
  app.get('/', async () => ({
    service: 'green-thumb',
    version: '0.1.0',
    docs: '/docs',
    health: '/api/v1/health',
  }));

  // API v1
  app.register(registerRoutes, { prefix: '/api/v1' });

  return app;
}
