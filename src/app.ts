import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import { resolve } from 'node:path';
import yaml from 'yaml';
import errorHandlerPlugin from './plugins/error-handler.js';
import timingPlugin from './plugins/timing.js';
import jwtPlugin from './plugins/jwt.js';
import prismaPlugin from './plugins/prisma.js';
import websocketPlugin from './plugins/websocket.js';
import { registerRoutes } from './routes/index.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerWsRoutes } from './routes/ws.js';

import type { AppConfig } from './lib/config.js';

declare module 'fastify' {
  interface FastifyInstance {
    uploadsDir: string;
    config: AppConfig;
  }
}

// Where @fastify/swagger-ui static assets live on disk
const SWAGGER_UI_STATIC = resolve(process.cwd(), 'node_modules/@fastify/swagger-ui/static');

export function buildApp(config: AppConfig) {
  const uploadsDir = resolve(process.cwd(), config.UPLOADS_DIR);

  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
  });

  app.decorate('uploadsDir', uploadsDir);
  app.decorate('config', config);

  // CORS — open for API docs and cross-origin Swagger UI usage
  app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
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
        description: `Gardening knowledge RAG API — ingest PDF/EPUB/TXT books, query structured plant data, and get AI-powered answers from your garden library.

## What You Can Do

- **Search plants** — look up 9,359 plants with growing conditions (zones, sunlight, water, soil, companions)
- **Companion planting** — get instant companion/antagonist lists for 259 plants (<50ms, no LLM)
- **Semantic search** — ask any gardening question and get answers synthesized from 31 ingested books
- **Pest & disease lookup** — semantic search across 1,038 pest-related chunks and 294 disease chunks
- **Ingest your own books** — upload PDF/EPUB/TXT and search your private garden library

## Authentication

Two options:

1. **API Key** (recommended for testing & external apps) — pass \`X-API-Key: <your-key>\` header
2. **JWT Bearer** — obtain a token via \`POST /api/v1/auth/login\` and pass \`Authorization: Bearer <token>\`

API keys: \`POST /api/v1/auth/signup\` → \`POST /api/v1/auth/login\` → \`POST /api/v1/api-keys\` to create one.

## Data Sources

- **Permapeople** (CC BY-SA 4.0) — ~9,000 plant growing conditions
- **PFAF (Plants For A Future)** — 8,504 plants with hardiness zones, sunlight, water, soil, family, descriptions, photos
- **University extension sources** — Cornell, Michigan State, Oregon State companion planting data
- **Wikipedia** (CC BY-SA) — supplemental companion planting table
- **31 ingested books** — 3,775 chunks covering vegetables, fruits, herbs, pests, diseases, composting, permaculture

## Performance

| Endpoint | Speed | Auth |
|----------|-------|------|
| \`/search/companions\` | <50ms | API key |
| \`/search/plants\` | <100ms | API key |
| \`/search/enrich\` | <200ms | API key |
| \`/search\` (semantic) | 200–500ms | JWT or API key |
| \`/search/ask\` (RAG) | 2–15s | JWT or API key |`,
        version: '0.1.0',
        contact: { name: 'Green-Thumb API' },
      },
      servers: [
        { url: 'https://api.dnd-dad.com', description: 'Production' },
        { url: 'http://localhost:4041', description: 'Local development' },
        { url: 'http://192.168.0.102:4041', description: 'LAN access' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token from POST /api/v1/auth/login',
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'API key from POST /api/v1/api-keys (after login). Preferred over JWT for external apps.',
          },
        },
      },
      tags: [
        { name: 'search', description: 'Start here — companion planting (<50ms), semantic search, RAG Q&A' },
        { name: 'plants', description: 'Browse, create, and manage structured plant entries' },
        { name: 'books', description: 'Upload and ingest PDF/EPUB/TXT books and web articles' },
        { name: 'tasks', description: 'Actionable gardening tasks extracted from book content' },
        { name: 'data', description: 'Seed, re-import, and manage data sources' },
        { name: 'auth', description: 'Create account and obtain JWT token' },
        { name: 'api-keys', description: 'Create and manage API keys (recommended for external apps)' },
        { name: 'webhooks', description: 'Subscribe to events for real-time notifications' },
      ],
    },
  });

  // Serve swagger-ui static assets at /docs/static/*
  app.register(fastifyStatic, {
    root: SWAGGER_UI_STATIC,
    prefix: '/docs/static/',
    decorateReply: false,
  });

  // Swagger UI — /docs/ HTML page, /docs/json, /docs/yaml
  // (built manually to avoid @fastify/swagger-ui's broken internal static registration)
  app.get('/docs/json', async (_request, reply) => {
    return reply.send(app.swagger());
  });

  app.get('/docs/yaml', async (_request, reply) => {
    reply.header('content-type', 'application/x-yaml');
    return yaml.stringify(app.swagger());
  });

  app.get('/docs', async (_request, reply) => {
    return reply.redirect('/docs/');
  });

  app.get('/docs/', async (_request, reply) => {
    const specUrl = '/docs/json';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Green-Thumb API — Swagger UI</title>
  <link rel="stylesheet" href="/docs/static/swagger-ui.css">
  <link rel="stylesheet" href="/docs/static/index.css">
  <link rel="icon" type="image/png" href="/docs/static/favicon-32x32.png" sizes="32x32">
  <style>
    .topbar { display: none; }
    .swagger-ui .info .title { font-size: 2.5em; }
    .swagger-ui .info .description { font-size: 1.1em; line-height: 1.6; max-width: 900px; }
    .api-key-btn { background: #2e7d32; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 10px 0; }
    .api-key-btn:hover { background: #1b5e20; }
    #api-key-section { background: #f1f8e9; border: 1px solid #a5d6a7; border-radius: 6px; padding: 16px; margin-bottom: 20px; }
    #api-key-section label { font-weight: bold; display: block; margin-bottom: 6px; }
    #api-key-section input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-family: monospace; }
    #api-key-section small { color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/static/swagger-ui-bundle.js"></script>
  <script src="/docs/static/swagger-ui-standalone-preset.js"></script>
  <script>
    // Persist API key or JWT token across page reloads
    const STORAGE_KEY = 'gt_swagger_auth';

    function getStoredAuth() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
      catch (e) { return {}; }
    }

    function storeAuth(key, value) {
      const auth = getStoredAuth();
      auth[key] = value;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    }

    window.onload = function() {
      const stored = getStoredAuth();

      const ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout',
        info: {
          title: 'Green-Thumb API',
          version: '0.1.0',
        },
        persistAuthorization: true,
        tryItOutEnabled: true,
        withCredentials: true,
        // Pre-fill auth from localStorage if available
        onAuthorize: function(authObj) {
          if (authObj.apiKeyAuth) {
            storeAuth('apiKey', authObj.apiKeyAuth.value);
          } else if (authObj.bearerAuth) {
            storeAuth('bearer', authObj.bearerAuth.value);
          }
        },
        // Intercept requests and inject API key if stored
        requestInterceptor: function(request) {
          const auth = getStoredAuth();
          if (auth.apiKey && !request.headers['X-API-Key']) {
            request.headers['X-API-Key'] = auth.apiKey;
          }
          return request;
        },
      });

      window.ui = ui;
    };
  </script>
</body>
</html>`;
    reply.header('content-type', 'text/html');
    return html;
  });

  app.setErrorHandler(errorHandlerPlugin);
  app.register(timingPlugin);
  app.register(jwtPlugin, { accessSecret: config.JWT_ACCESS_SECRET });
  app.register(prismaPlugin);
  app.register(websocketPlugin);

  // Root
  app.get('/', async () => ({
    service: 'green-thumb',
    version: '0.1.0',
    docs: '/docs',
    health: '/api/v1/health',
  }));

  // API v1
  app.register(registerRoutes, { prefix: '/api/v1' });

  // API key management routes
  app.register(registerApiKeyRoutes, { prefix: '/api/v1' });

  // Metrics endpoint (no auth)
  app.register(registerMetricsRoutes);

  // WebSocket endpoint for real-time events
  app.register(registerWsRoutes);

  return app;
}
