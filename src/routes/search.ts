import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { queryOllamaEmbedding } from '../services/ollama.js';
import { semanticSearch } from '../services/search.js';

// GET /search — semantic search across all book chunks
export async function registerSearchRoutes(app: FastifyInstance) {
  app.get('/search', {
    schema: {
      description: 'Semantic search across all ingested book knowledge. Embeds the query and finds the most relevant chunks.',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, description: 'Search query' },
          type: {
            type: 'string',
            enum: ['plant', 'pest', 'disease', 'composting', 'tip', 'task', 'general'],
            description: 'Filter by content type',
          },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          bookId: { type: 'string', description: 'Limit search to a specific book' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  chunkId: { type: 'string' },
                  contentText: { type: 'string' },
                  contentType: { type: 'string' },
                  chapter: { type: 'string' },
                  relevance: { type: 'number' },
                  book: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                    },
                  },
                },
              },
            },
            total: { type: 'number' },
          },
        },
      },
    },
  }, async (request) => {
    const { q, type, limit = 10, bookId } = z.object({
      q: z.string().min(1),
      type: z.enum(['plant', 'pest', 'disease', 'composting', 'tip', 'task', 'general']).optional(),
      limit: z.number().int().min(1).max(50).default(10),
      bookId: z.string().optional(),
    }).parse(request.query);

    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    const results = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      contentType: type,
      bookId,
      limit,
    });

    return {
      query: q,
      items: results.map(r => ({
        chunkId: r.chunk.id,
        contentText: r.chunk.contentText,
        contentType: r.chunk.contentType,
        chapter: r.chunk.chapter,
        section: r.chunk.section,
        relevance: r.score,
        book: {
          id: r.chunk.book.id,
          title: r.chunk.book.title,
        },
      })),
      total: results.length,
    };
  });

  // GET /search/plants — search filtered to plant info
  app.get('/search/plants', {
    schema: {
      description: 'Search for plant-specific information',
      tags: ['plants', 'search'],
    },
  }, async (request) => {
    const { q, limit } = z.object({
      q: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }).parse(request.query);

    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    const results = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      contentType: 'plant',
      limit,
    });

    return {
      query: q,
      items: results,
      total: results.length,
    };
  });

  // GET /search/pests — search filtered to pest/disease info
  app.get('/search/pests', {
    schema: {
      description: 'Search for pest and disease information',
      tags: ['search'],
    },
  }, async (request) => {
    const { q, limit } = z.object({
      q: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }).parse(request.query);

    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    const results = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      contentType: 'pest',
      limit,
    });

    return { query: q, items: results, total: results.length };
  });

  // GET /search/tips — search for gardening tips and tasks
  app.get('/search/tips', {
    schema: {
      description: 'Search for gardening tips, tasks, and actionable advice',
      tags: ['search', 'tasks'],
    },
  }, async (request) => {
    const { q, limit } = z.object({
      q: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }).parse(request.query);

    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    const results = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      contentType: 'tip',
      limit,
    });

    return { query: q, items: results, total: results.length };
  });
}
