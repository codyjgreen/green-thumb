import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { queryOllamaEmbedding, queryOllamaChat, streamOllamaChat } from '../services/ollama.js';
import { semanticSearch } from '../services/search.js';
import { searchWeb, fetchArticleText } from '../services/web.js';
import { processUrlIngestion } from './books.js';
import { createJob } from '../lib/jobs.js';

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

  // GET /search/ask — RAG-based AI answering (supports streaming & web research)
  app.get('/search/ask', {
    schema: {
      description: 'Ask a question to your gardening knowledge base. Uses RAG to synthesize an answer from your books.',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, description: 'The question to ask' },
          type: {
            type: 'string',
            enum: ['plant', 'pest', 'disease', 'composting', 'tip', 'task', 'general'],
            description: 'Filter context by content type',
          },
          limit: { type: 'integer', minimum: 1, maximum: 15, default: 5, description: 'Number of chunks to use as context' },
          stream: { type: 'boolean', default: false, description: 'Stream the response tokens' },
          web: { type: 'boolean', default: false, description: 'Allow AI to research the web if info is missing' },
        },
      },
    },
  }, async (request, reply) => {
    const { q, type, limit = 5, stream = false, web = false } = z.object({
      q: z.string().min(1),
      type: z.enum(['plant', 'pest', 'disease', 'composting', 'tip', 'task', 'general']).optional(),
      limit: z.number().int().min(1).max(15).default(5),
      stream: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
      web: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
    }).parse(request.query);

    // 1. Get embedding for the question
    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    // 2. Retrieve most relevant context chunks from DB
    const dbResults = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      contentType: type,
      limit,
    });

    let contextItems = dbResults.map(r => ({
      chunkId: r.chunk.id,
      contentText: r.chunk.contentText,
      contentType: r.chunk.contentType,
      bookTitle: r.chunk.book.title,
    }));

    // 3. Web Research (if requested)
    let webSource: any = null;
    if (web) {
      const urls = await searchWeb(q, 1);
      if (urls.length > 0) {
        try {
          const article = await fetchArticleText(urls[0]);
          webSource = {
            chunkId: 'web-result',
            contentText: article.content.slice(0, 3000), // Cap context size
            contentType: 'general',
            bookTitle: `Web: ${article.title}`,
            url: urls[0]
          };
          contextItems.unshift(webSource);
          
          // Trigger background ingestion of this web page for future use
          const jobId = randomUUID();
          createJob(jobId);
          processUrlIngestion(jobId, urls[0], app.prisma, app.config);
        } catch (err) {
          console.error('[WebResearch] Failed to fetch article:', err);
        }
      }
    }

    if (contextItems.length === 0) {
      const fallback = {
        query: q,
        answer: "I couldn't find any information in your library or on the web to answer that question.",
        items: [],
      };
      if (stream) {
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        reply.raw.write(`data: ${JSON.stringify({ type: 'answer', content: fallback.answer })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        return reply.raw.end();
      }
      return fallback;
    }

    // 4. Prepare context for LLM
    const context = contextItems.map((r, i) => 
      `--- CONTEXT CHUNK ${i + 1} (from "${r.bookTitle}") ---\n${r.contentText}`
    ).join('\n\n');

    const systemPrompt = `You are a helpful gardening assistant. 
Answer the user's question using the provided context from their gardening library and web research.
Cite your sources by mentioning the book title or "Web: [Title]" where appropriate.
If the answer is not in the context, say you don't know based on the provided info.
Keep your answer concise, practical, and encouraging.`;

    const userMessage = `CONTEXT:\n${context}\n\nQUESTION: ${q}`;

    // 5. Handle Streaming
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });

      // Send sources first
      reply.raw.write(`data: ${JSON.stringify({ type: 'sources', items: contextItems })}\n\n`);

      // Stream tokens
      const streamGen = streamOllamaChat(
        app.config.OLLAMA_BASE_URL,
        app.config.OLLAMA_CHAT_MODEL,
        systemPrompt,
        userMessage
      );

      for await (const token of streamGen) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
      }

      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      return reply.raw.end();
    }

    // 6. Generate synthesized answer (non-streaming)
    const answer = await queryOllamaChat(
      app.config.OLLAMA_BASE_URL,
      app.config.OLLAMA_CHAT_MODEL,
      systemPrompt,
      userMessage
    );

    return {
      query: q,
      answer,
      items: contextItems,
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
