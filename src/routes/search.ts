import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { queryOllamaEmbedding, queryOllamaChat, streamOllamaChat } from '../services/ollama.js';
import { semanticSearch } from '../services/search.js';
import { searchWeb, fetchArticleText, braveSearch } from '../services/web.js';
import { processUrlIngestion } from './books.js';
import { createJob } from '../lib/jobs.js';
import { emitEvent } from '../services/webhooks.js';

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
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
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

    emitEvent(app.prisma, 'search.query', { query: q, type, limit, bookId, resultCount: results.length });

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
    await app.authenticate(request, reply);
    if (reply.sent) return;
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

    // 3. Web Research — auto-fallback when DB has no results, or opt-in via ?web=true
    const needsWebSearch = web || dbResults.length === 0;
    if (needsWebSearch) {
      const braveResults = await braveSearch(q, 3);

      // Try fetching articles from Brave results, up to 3 URLs
      let articleContent: string | null = null;
      let articleTitle = 'Web Search';
      let articleUrl: string | null = null;

      for (const result of braveResults) {
        try {
          const article = await fetchArticleText(result.url);
          articleContent = article.content.slice(0, 3000);
          articleTitle = article.title;
          articleUrl = result.url;
          break; // Use first successful fetch
        } catch (err) {
          console.error(`[WebResearch] Failed to fetch ${result.url}:`, err);
        }
      }

      // Fall back to Brave snippets if all article fetches failed
      if (!articleContent && braveResults.length > 0) {
        const snippetText = braveResults
          .map(r => `${r.title}: ${r.description}`)
          .join('\n\n');
        articleContent = snippetText.slice(0, 3000);
        articleTitle = `Web Search: ${q}`;
        articleUrl = braveResults[0].url;
      }

      if (articleContent) {
        contextItems.unshift({
          chunkId: 'web-result',
          contentText: articleContent,
          contentType: 'general',
          bookTitle: articleTitle,
          url: articleUrl
        } as any);

        // Trigger background ingestion of the first URL for future use
        if (articleUrl) {
          const jobId = randomUUID();
          createJob(jobId);
          processUrlIngestion(jobId, articleUrl, app.prisma, app.config);
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
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        });
        reply.raw.write(`data: ${JSON.stringify({ type: 'answer', content: fallback.answer })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return reply.send(fallback);
    }

    // 4. Prepare context for LLM
    const context = contextItems.map((r, i) => 
      `--- CONTEXT CHUNK ${i + 1} (from "${r.bookTitle}") ---\n${r.contentText}`
    ).join('\n\n');

    const systemPrompt = `You are a helpful gardening assistant.
Answer the user's question using only the provided context from their gardening library and web research.
Do NOT mention sources, books, or citations in your answer text. The user can view source attribution separately.
If the answer is not in the context, say you don't know based on the provided info.
Keep your answer concise, practical, and encouraging.`;

    const userMessage = `CONTEXT:\n${context}\n\nQUESTION: ${q}`;

    // 5. Handle Streaming
    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
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
      reply.raw.end();
      return reply;
    }

    // 6. Generate synthesized answer (non-streaming)
    const answer = await queryOllamaChat(
      app.config.OLLAMA_BASE_URL,
      app.config.OLLAMA_CHAT_MODEL,
      systemPrompt,
      userMessage
    );

    return reply.send({
      query: q,
      answer,
      items: contextItems,
    });
  });

  // GET /search/companions — instant companion plant lookup from DB
  // Returns pre-stored companion and incompatible plant data directly from the DB.
  // Falls back to RAG-powered /search/recommend if DB has no data.
  app.get('/search/companions', {
    schema: {
      description: 'Instant companion plant lookup from pre-stored DB data. Falls back to RAG if no DB data.',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, description: 'Plant name to look up' },
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { q } = z.object({
      q: z.string().min(1),
    }).parse(request.query);

    const queryLower = q.toLowerCase().trim();

    // Find plant in DB: try exact match first, then partial
    const firstWord = queryLower.split(' ')[0];

    // Try exact commonName or scientificName match first
    let plant = await app.prisma.plantEntry.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { commonName: { equals: queryLower, mode: 'insensitive' } },
          { scientificName: { equals: queryLower, mode: 'insensitive' } },
        ],
      },
      select: {
        commonName: true,
        scientificName: true,
        companionPlants: true,
        incompatiblePlants: true,
        commonPests: true,
        sunlight: true,
        waterNeeds: true,
        soilType: true,
        zoneMin: true,
        zoneMax: true,
      },
    });

    // Fall back to partial match: query appears anywhere in name
    if (!plant && queryLower.length > 2) {
      plant = await app.prisma.plantEntry.findFirst({
        where: {
          deletedAt: null,
          commonName: { contains: queryLower, mode: 'insensitive' },
        },
        select: {
          commonName: true,
          scientificName: true,
          companionPlants: true,
          incompatiblePlants: true,
          commonPests: true,
          sunlight: true,
          waterNeeds: true,
          soilType: true,
          zoneMin: true,
          zoneMax: true,
        },
      });
    }

    // Last resort: partial match on first word only
    if (!plant && firstWord.length > 2) {
      plant = await app.prisma.plantEntry.findFirst({
        where: {
          deletedAt: null,
          commonName: { contains: firstWord, mode: 'insensitive' },
        },
        select: {
          commonName: true,
          scientificName: true,
          companionPlants: true,
          incompatiblePlants: true,
          commonPests: true,
          sunlight: true,
          waterNeeds: true,
          soilType: true,
          zoneMin: true,
          zoneMax: true,
        },
      });
    }

    if (!plant) {
      return reply.status(404).send({ error: 'Plant not found in DB' });
    }

    const companions = Array.isArray(plant.companionPlants) ? plant.companionPlants.filter(Boolean) : [];
    const incompatible = Array.isArray(plant.incompatiblePlants) ? plant.incompatiblePlants.filter(Boolean) : [];

    if (companions.length === 0 && incompatible.length === 0) {
      return reply.status(404).send({ error: 'No companion data for this plant', plant: plant.commonName });
    }

    return {
      source: 'green-thumb-db',
      plant: plant.commonName,
      scientificName: plant.scientificName,
      companionPlants: companions,
      incompatiblePlants: incompatible,
      growingInfo: {
        sunlight: plant.sunlight,
        waterNeeds: plant.waterNeeds,
        soilType: plant.soilType,
        hardinessZone: plant.zoneMin && plant.zoneMax ? `${plant.zoneMin}-${plant.zoneMax}` : null,
      },
    };
  });

  // GET /search/recommend — gardening recommendation engine
  // Combines RAG semantic search with structured plant DB data to give
  // companion planting, crop rotation, and pest management recommendations.
  app.get('/search/recommend', {
    schema: {
      description: 'Get gardening recommendations — companion plants, crop rotation, pest management, and what to plant next. Combines RAG semantic search with structured plant data.',
      tags: ['search'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, description: 'Gardening question or context (e.g., "tomatoes in raised bed", "aphids on roses", "what to plant after lettuce")' },
          intent: {
            type: 'string',
            enum: ['companion', 'rotation', 'pest', 'soil', 'general'],
            description: 'Force a specific recommendation type. Auto-detected if omitted.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
        },
      },
    },
  }, async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { q, intent: forcedIntent, limit = 8 } = z.object({
      q: z.string().min(1),
      intent: z.enum(['companion', 'rotation', 'pest', 'soil', 'general']).optional(),
      limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(20).default(8)),
    }).parse(request.query);

    // 1. Get embedding and perform semantic search
    const queryEmbedding = await queryOllamaEmbedding(q, app.config.OLLAMA_BASE_URL, app.config.OLLAMA_EMBEDDING_MODEL);

    const dbResults = await semanticSearch(app.prisma, {
      queryEmbedding,
      model: app.config.OLLAMA_EMBEDDING_MODEL,
      limit,
    });

    const contextItems = dbResults.map(r => ({
      chunkId: r.chunk.id,
      contentText: r.chunk.contentText,
      contentType: r.chunk.contentType,
      bookTitle: r.chunk.book.title,
      score: r.score,
    }));

    // 2. Try to detect mentioned plants from the query (simple keyword extraction)
    // Use full-text search with pagination to avoid fetching all plants on large datasets
    const queryLower = q.toLowerCase();
    const searchTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    
    // Build a where clause that filters by search terms if provided
    const plantWhere: any = { deletedAt: null };
    if (searchTerms.length > 0) {
      plantWhere.OR = searchTerms.flatMap(term => [
        { commonName: { contains: term } },
        { scientificName: { contains: term } },
      ]);
    }
    
    // Fetch a limited set first, then filter to mentioned plants
    const candidatePlants = await app.prisma.plantEntry.findMany({
      where: plantWhere,
      select: { id: true, commonName: true, scientificName: true },
      take: 500, // Limit candidates to avoid slow queries on large datasets
    });
    
    const mentionedPlants = candidatePlants
      .filter(p =>
        (p.commonName && queryLower.includes(p.commonName.toLowerCase())) ||
        (p.scientificName && queryLower.includes(p.scientificName.toLowerCase()))
      )
      .slice(0, 5);

    // 3. Fetch structured data for mentioned plants
    const structuredData: Record<string, any> = {};
    if (mentionedPlants.length > 0) {
      const plantIds = mentionedPlants.map(p => p.id);
      const plantsWithData = await app.prisma.plantEntry.findMany({
        where: { id: { in: plantIds } },
        select: {
          commonName: true,
          scientificName: true,
          category: true,
          companionPlants: true,
          incompatiblePlants: true,
          commonPests: true,
          commonDiseases: true,
          soilType: true,
          sunlight: true,
          waterNeeds: true,
          daysToMaturity: true,
        },
      });
      for (const p of plantsWithData) {
        structuredData[p.commonName.toLowerCase()] = p;
      }
    }

    // 4. Auto-detect intent from query and context
    const contextTypes = contextItems.map(c => c.contentType);
    let intent = forcedIntent;
    if (!intent) {
      if (queryLower.match(/(rotate|after|before|plant(ing)?.?season|succession)/)) intent = 'rotation';
      else if (queryLower.match(/(pest|aphid|beetle|bug|insect|worm|spray|infest)/)) intent = 'pest';
      else if (queryLower.match(/(soil|compost|amend|fertil|drainage)/)) intent = 'soil';
      else if (queryLower.match(/(companion|together|next.?to|plant.?with|avoid|grow.?with)/)) intent = 'companion';
      else intent = 'general';
    }

    // 5. Build gardening-specific system prompt
    const intentDescriptions: Record<string, string> = {
      companion: 'Focus on which plants grow well together and which should be kept apart. Give specific plant names and reasons.',
      rotation: 'Focus on what to plant before and after the main crop, and which plant families to follow or avoid.',
      pest: 'Focus on organic pest identification and prevention, and which plants naturally repel pests.',
      soil: 'Focus on soil preparation, composting, pH adjustment, and improving soil health organically.',
      general: 'Give practical, actionable gardening advice based on the context provided.',
    };

    const systemPrompt = `You are an expert organic gardening assistant.
Your task: Provide specific, actionable ${intent || 'general'} planting recommendations.

${intentDescriptions[intent || 'general']}

Format your response as a JSON object with this structure:
{
  "intent": "companion|rotation|pest|soil|general",
  "summary": "2-3 sentence overview of the recommendation",
  "recommendations": [
    {
      "plant": "plant name (or 'Avoid: plant name')",
      "type": "companion|avoid|succession|cover|pest_control|soil_building|general",
      "reason": "specific reason why",
      "source": "book or study that supports this"
    }
  ]
}

Rules:
- Always include at least 3 specific recommendations when possible
- Include "Avoid" type recommendations when relevant
- Cite specific plant names and varieties when possible
- If the context doesn't support a recommendation, say "not enough info" instead of making it up
- Be concise and practical for a home gardener`;

    // 6. Build context string
    let structuredContext = '';
    if (Object.keys(structuredData).length > 0) {
      structuredContext = '\n\nSTRUCTURED PLANT DATA FROM DATABASE:\n' +
        Object.entries(structuredData).map(([name, data]: [string, any]) =>
          `${name}: companions=${data.companionPlants?.join(', ') || 'unknown'}, ` +
          `incompatible=${data.incompatiblePlants?.join(', ') || 'unknown'}, ` +
          `pests=${data.commonPests?.join(', ') || 'unknown'}`
        ).join('\n');
    }

    const context = contextItems.map((r, i) =>
      `--- CONTEXT ${i + 1} [${r.contentType}] from "${r.bookTitle}" ---\n${r.contentText.slice(0, 600)}`
    ).join('\n\n');

    const userMessage = `QUESTION: ${q}${structuredContext}\n\n${context}`;

    // 7. Generate recommendation
    const answer = await queryOllamaChat(
      app.config.OLLAMA_BASE_URL,
      app.config.OLLAMA_CHAT_MODEL,
      systemPrompt,
      userMessage
    );

    // 8. Parse the JSON answer
    let recommendations: any[] = [];
    let summary = '';
    let detectedIntent = intent || 'general';

    try {
      // Try to extract JSON from the response (handles markdown code blocks)
      let jsonStr = answer.trim();
      const jsonMatch = jsonStr.match(/```json\n?([\s\S]*?)```/) ||
                        jsonStr.match(/```\n?([\s\S]*?)```/) ||
                        jsonStr.match(/^\s*\{([\s\S]*)\}\s*$/);
      if (jsonMatch) jsonStr = jsonMatch[1].startsWith('{') ? jsonMatch[1] : jsonMatch[2] || jsonMatch[1];
      if (!jsonStr.startsWith('{')) jsonStr = '{' + jsonStr.split('{').slice(1).join('{').split('}').slice(0, -1).join('}') + '}';

      const parsed = JSON.parse(jsonStr);
      recommendations = parsed.recommendations || [];
      summary = parsed.summary || '';
      detectedIntent = parsed.intent || detectedIntent;
    } catch {
      // Fallback: treat entire answer as a text summary
      summary = answer.slice(0, 500);
      recommendations = [];
    }

    return {
      query: q,
      intent: detectedIntent,
      summary,
      recommendations,
      plantsMentioned: mentionedPlants.map(p => p.commonName),
      structuredData,
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
      limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50).default(10)),
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
      limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50).default(10)),
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
      limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50).default(10)),
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
