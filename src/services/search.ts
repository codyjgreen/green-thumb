import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../lib/config.js';
import { loadConfig } from '../lib/config.js';
import { cachedQueryOllamaEmbedding } from './ollama.js';
import { classifySection, splitIntoChunks } from './extractor.js';
import { getRedisClient } from '../lib/redis.js';

export interface SearchResult {
  chunk: {
    id: string;
    contentText: string;
    contentType: string;
    chapter: string | null;
    section: string | null;
    book: {
      id: string;
      title: string;
    };
  };
  score: number;
}

export interface SemanticSearchOptions {
  queryEmbedding: number[];
  model: string;
  contentType?: string;
  bookId?: string;
  limit?: number;
}



/**
 * Perform semantic (vector) search using pgvector cosine similarity.
 * Results are cached in Redis for SEARCH_CACHE_TTL_SECONDS.
 * Cache misses fall through to the DB query.
 */
export async function semanticSearch(
  prisma: PrismaClient,
  options: SemanticSearchOptions
): Promise<SearchResult[]> {
  const { queryEmbedding, model, contentType, bookId, limit = 10 } = options;

  const config = loadConfig();
  // Use the full embedding (hashed) for the cache key to avoid collisions.
  // Truncating to 32 dims would cause different full embeddings that share the same
  // 32-dim prefix to share a cache key, producing wrong search results.
  const cachePayload = JSON.stringify({ queryEmbedding, model, contentType, bookId, limit });
  const cacheKey = `search:${createHash('sha256').update(cachePayload).digest('hex')}`;

  try {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as SearchResult[];
    }
  } catch {
    // Redis unavailable — fall through to DB query
  }

  const results = await semanticSearchUncached(prisma, options);

  try {
    const redis = getRedisClient();
    await redis.setex(cacheKey, config.SEARCH_CACHE_TTL_SECONDS, JSON.stringify(results));
  } catch {
    // Cache write failure is non-fatal
  }

  return results;
}

/**
 * Uncached semantic search — performs the raw DB query.
 */
export async function semanticSearchUncached(
  prisma: PrismaClient,
  options: SemanticSearchOptions
): Promise<SearchResult[]> {
  const { queryEmbedding, model, contentType, bookId, limit = 10 } = options;

  // Build parameterized WHERE clause for non-vector filters.
  // Note: pgvector's <=> operator requires raw SQL for the vector comparison,
  // but all user-controlled string/number values use parameterized placeholders.
  const conditions: string[] = ['ce."chunkId" = bc.id'];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (model) {
    conditions.push(`ce.model = $${paramIndex}`);
    params.push(model);
    paramIndex++;
  }

  if (contentType) {
    conditions.push(`bc."contentType" = $${paramIndex}`);
    params.push(contentType);
    paramIndex++;
  }

  if (bookId) {
    conditions.push(`bc."bookId" = $${paramIndex}`);
    params.push(bookId);
    paramIndex++;
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ');

  // The vector literal must be inline (pgvector doesn't support parameterized vectors),
  // but all other values are parameterized to prevent SQL injection.
  const limitParamIndex = paramIndex;
  params.push(limit);

  const query = `
    SELECT
      ce."chunkId",
      1 - (ce.vector::vector <=> $${paramIndex + 1}::vector) AS similarity
    FROM "chunk_embeddings" ce
    JOIN "book_chunks" bc ON ce."chunkId" = bc.id
    ${whereClause}
    ORDER BY ce.vector::vector <=> $${paramIndex + 1}::vector
    LIMIT $${limitParamIndex}
  `;

  // params: [...filters, limit, embedding vector]
  // embedding vector is last so the vector literal placeholder stays at the end
  const fullParams: (string | number)[] = [...params, `[${queryEmbedding.join(',')}]`];

  const results = await prisma.$queryRawUnsafe<
    { chunkId: string; similarity: number }[]
  >(query, ...fullParams);

  if (results.length === 0) return [];

  const chunkIds = results.map(r => r.chunkId);
  const scoreMap = new Map(results.map(r => [r.chunkId, r.similarity]));

  const chunks = await prisma.bookChunk.findMany({
    where: { id: { in: chunkIds } },
    include: {
      book: { select: { id: true, title: true } },
      // TODO: `model` field from BookChunk (embedding model used) could be used for
      // result ranking/filtering, e.g. preferring newer/chunk-quality embeddings.
    },
  });

  return chunks
    .map(chunk => ({
      chunk: {
        id: chunk.id,
        contentText: chunk.contentText,
        contentType: chunk.contentType,
        chapter: chunk.chapter,
        section: chunk.section,
        book: chunk.book,
      },
      score: scoreMap.get(chunk.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Chunk a book's sections and embed each chunk, storing in the DB.
 * Uses cached embeddings when available.
 * Calls onProgress(current, total) after each chunk is embedded.
 */
export async function chunkAndEmbed(
  prisma: PrismaClient,
  config: AppConfig,
  bookId: string,
  sections: { title: string; content: string; pageNumber?: number }[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ id: string }[]> {
  const { OLLAMA_BASE_URL, OLLAMA_EMBEDDING_MODEL } = config;
  const createdChunks: { id: string }[] = [];

  // First pass: count total chunks so we can report accurate progress
  const sectionChunks: { section: typeof sections[0]; chunks: string[] }[] = [];
  let totalChunks = 0;
  for (const section of sections) {
    if (section.content.trim().length < 50) continue;
    const contentType = classifySection(section.title, section.content);
    const textChunks = splitIntoChunks(section.content);
    sectionChunks.push({ section, chunks: textChunks });
    totalChunks += textChunks.length;
  }

  let processed = 0;
  for (const { section, chunks } of sectionChunks) {
    const contentType = classifySection(section.title, section.content);

    for (const chunkText of chunks) {
      // Get embedding from Ollama (with Redis caching)
      const embedding = await cachedQueryOllamaEmbedding(
        chunkText,
        OLLAMA_BASE_URL,
        OLLAMA_EMBEDDING_MODEL
      );

      // Sanitize text: remove null bytes and fix malformed Unicode (lone surrogates)
      const sanitizedText = chunkText
        .replace(/\0/g, '')
        .toWellFormed();

      const chunk = await prisma.bookChunk.create({
        data: {
          bookId,
          chapter: section.title,
          contentType,
          contentText: sanitizedText,
          pageNumber: section.pageNumber,
          tokenCount: Math.ceil(sanitizedText.length / 4),
        },
      });

      await prisma.chunkEmbedding.create({
        data: {
          chunkId: chunk.id,
          model: OLLAMA_EMBEDDING_MODEL,
          dimension: embedding.length,
          vector: embedding,
        },
      });

      createdChunks.push({ id: chunk.id });
      processed++;
      if (onProgress) onProgress(processed, totalChunks);
    }
  }

  return createdChunks;
}
