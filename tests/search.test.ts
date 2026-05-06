import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSearchRoutes } from '../../src/routes/search.js';

// --- Mocks for all route dependencies ---
// Must be before import of registerSearchRoutes

// Mock config loading (search service calls loadConfig for SEARCH_CACHE_TTL_SECONDS)
vi.mock('../../src/lib/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    NODE_ENV: 'test',
    API_PORT: 3002,
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    UPLOADS_DIR: '/uploads',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_EMBEDDING_MODEL: 'llama3.2:3b',
    OLLAMA_CHAT_MODEL: 'llama3.2:3b',
    REDIS_URL: 'redis://localhost:6379',
    SEARCH_CACHE_TTL_SECONDS: 300,
    EMBEDDING_CACHE_TTL_SECONDS: 604800,
    OLLAMA_MAX_CONCURRENT: 2,
    OLLAMA_QUEUE_MAX: 50,
    OLLAMA_MIN_GAP_MS: 0,
    OLLAMA_REQUEST_TIMEOUT_MS: 120000,
    BRAVE_SEARCH_API_KEY: '',
    PERMAPEOPLE_KEY_ID: '',
    PERMAPEOPLE_KEY_SECRET: '',
    WS_PING_INTERVAL_MS: 30000,
    WS_PING_TIMEOUT_MS: 5000,
  }),
}));

// Mock Ollama (avoids real Ollama calls)
vi.mock('../../src/services/ollama.js', () => ({
  queryOllamaEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
  queryOllamaChat: vi.fn().mockResolvedValue('Mocked response from Ollama'),
  streamOllamaChat: vi.fn().mockImplementation(async function* () {
    yield 'Mocked';
    yield ' streamed';
    yield ' response';
  }),
}));

// Mock ollamaEnqueue (avoids module-level queue state)
vi.mock('../../src/lib/ollama-queue.js', () => ({
  ollamaEnqueue: vi.fn().mockImplementation(async (_model: string, fn: () => Promise<unknown>) => fn()),
}));

// Mock search service (prevents real redis/config calls at import time)
vi.mock('../../src/services/search.js', () => ({
  semanticSearch: vi.fn().mockResolvedValue([{
    chunk: {
      id: 'chunk-1',
      contentText: 'Plant tomatoes in full sun.',
      contentType: 'plant',
      chapter: 'Chapter 1',
      section: null,
      book: { id: 'book-1', title: 'Vegetable Gardening Guide' },
    },
    score: 0.95,
  }]),
  semanticSearchUncached: vi.fn(),
}));

// Mock Redis (search service calls getRedisClient on import)
vi.mock('../../src/lib/redis.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({
    get: vi.fn().mockRejectedValue(new Error('Redis not available')),
    setex: vi.fn().mockRejectedValue(new Error('Redis not available')),
  }),
  isRedisHealthy: vi.fn().mockResolvedValue(false),
}));

// Mock webhooks (emitEvent called in search routes)
vi.mock('../../src/services/webhooks.js', () => ({
  emitEvent: vi.fn(),
  broadcast: vi.fn(),
}));

// Mock web service
vi.mock('../../src/services/web.js', () => ({
  searchWeb: vi.fn().mockResolvedValue([]),
  fetchArticleText: vi.fn().mockResolvedValue({ title: 'Test', content: 'Test content' }),
  braveSearch: vi.fn().mockResolvedValue([]),
}));

// Mock jobs
vi.mock('../../src/lib/jobs.js', () => ({
  createJob: vi.fn(),
}));

// Mock books/processUrlIngestion
vi.mock('../../src/routes/books.js', () => ({
  processUrlIngestion: vi.fn(),
}));

// --- Test helpers ---

function createMockPrisma() {
  const chunks: Map<string, any> = new Map([
    ['chunk-1', { id: 'chunk-1', contentText: 'Plant tomatoes in full sun.', contentType: 'plant', chapter: 'Chapter 1', section: null, book: { id: 'book-1', title: 'Vegetable Gardening Guide' } }],
    ['chunk-2', { id: 'chunk-2', contentText: 'Aphids can be controlled with neem oil.', contentType: 'pest', chapter: 'Chapter 2', section: null, book: { id: 'book-1', title: 'Vegetable Gardening Guide' } }],
    ['chunk-3', { id: 'chunk-3', contentText: 'Composting adds nutrients to soil.', contentType: 'composting', chapter: 'Chapter 3', section: null, book: { id: 'book-2', title: 'Herb Garden Handbook' } }],
  ]);

  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ chunkId: 'chunk-1', similarity: 0.95 }]),
    bookChunk: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
        return (where.id.in as string[]).map(id => chunks.get(id)).filter((c): c is object => c !== undefined);
      }),
    },
    book: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'book-1', title: 'Vegetable Gardening Guide' },
        { id: 'book-2', title: 'Herb Garden Handbook' },
      ]),
    },
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

function buildTestApp(prisma: ReturnType<typeof createMockPrisma>) {
  const app = Fastify({ logger: false });

  app.decorate('prisma', prisma);

  app.decorate('config', {
    NODE_ENV: 'test',
    API_PORT: 3002,
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    UPLOADS_DIR: '/uploads',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_EMBEDDING_MODEL: 'llama3.2:3b',
    OLLAMA_CHAT_MODEL: 'llama3.2:3b',
    REDIS_URL: 'redis://localhost:6379',
    SEARCH_CACHE_TTL_SECONDS: 300,
    EMBEDDING_CACHE_TTL_SECONDS: 604800,
  });

  // Routes call app.authenticate as a beforeHandler
  app.decorate('authenticate', async function (_request: any, reply: any) {
    _request.user = { userId: 'test-user-id' };
    _request.auth = { type: 'jwt', userId: 'test-user-id' };
  });

  return app;
}

// --- Tests ---

describe('search routes', () => {
  let app: ReturnType<typeof buildTestApp>;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    mockPrisma = createMockPrisma();
    app = buildTestApp(mockPrisma);
    await registerSearchRoutes(app);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /search', () => {
    it('returns search results for a valid query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'tomatoes' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('tomatoes');
      expect(body.items).toBeInstanceOf(Array);
      expect(body.total).toBeDefined();
    });

    it('returns search results filtered by content type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'planting', type: 'plant' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('respects the limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'gardening', limit: '5' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('filters by bookId when provided', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'herbs', bookId: 'book-2' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeInstanceOf(Array);
    });

    it('returns 400 for missing query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for empty query string', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid content type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'test', type: 'not_a_type' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for limit exceeding maximum', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search',
        query: { q: 'test', limit: '100' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /search/ask', () => {
    it('returns RAG answer for a valid question', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/ask',
        query: { q: 'How do I grow tomatoes?' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('How do I grow tomatoes?');
      expect(body.answer).toBeDefined();
      expect(body.items).toBeInstanceOf(Array);
    });

    it('supports streaming response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/ask',
        query: { q: 'How do I grow tomatoes?', stream: 'true' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
    });

    it('respects limit parameter for context chunks', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/ask',
        query: { q: 'tomatoes', limit: '3' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('tomatoes');
      expect(body.items).toBeInstanceOf(Array);
    });

    it('returns 400 for missing query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/ask',
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for limit exceeding maximum', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/ask',
        query: { q: 'tomatoes', limit: '20' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /search/plants', () => {
    it('returns plant-filtered search results', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/plants',
        query: { q: 'tomato', limit: '5' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('tomato');
      expect(body.items).toBeInstanceOf(Array);
      expect(body.total).toBeDefined();
    });

    it('returns error for missing query (validation failure)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/plants',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /search/pests', () => {
    it('returns pest-filtered search results', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/pests',
        query: { q: 'aphids', limit: '5' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('aphids');
      expect(body.items).toBeInstanceOf(Array);
    });
  });

  describe('GET /search/tips', () => {
    it('returns tip-filtered search results', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/search/tips',
        query: { q: 'watering', limit: '5' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('watering');
      expect(body.items).toBeInstanceOf(Array);
    });
  });
});