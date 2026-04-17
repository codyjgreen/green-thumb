import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../lib/config.js';
import { queryOllamaEmbedding } from './ollama.js';

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
 * Returns chunks ordered by relevance score.
 */
export async function semanticSearch(
  prisma: PrismaClient,
  options: SemanticSearchOptions
): Promise<SearchResult[]> {
  const { queryEmbedding, model, contentType, bookId, limit = 10 } = options;

  // First find matching embeddings via pgvector cosine similarity
  // Uses raw SQL to access pgvector operators
  const whereClause = contentType && bookId
    ? `WHERE ce."chunkId" = bc.id AND bc."contentType" = '${contentType}' AND bc."bookId" = '${bookId}'`
    : contentType
    ? `WHERE ce."chunkId" = bc.id AND bc."contentType" = '${contentType}'`
    : bookId
    ? `WHERE ce."chunkId" = bc.id AND bc."bookId" = '${bookId}'`
    : `WHERE ce."chunkId" = bc.id`;

  const query = `
    SELECT
      ce."chunkId",
      1 - (ce.vector <=> '[${queryEmbedding.join(',')}]'::vector) AS similarity
    FROM "chunk_embeddings" ce
    JOIN "book_chunks" bc ON ce."chunkId" = bc.id
    ${whereClause}
    AND ce.model = '${model}'
    ORDER BY ce.vector <=> '[${queryEmbedding.join(',')}]'::vector
    LIMIT ${limit}
  `;

  const results = await prisma.$queryRawUnsafe<
    { chunkId: string; similarity: number }[]
  >(query);

  if (results.length === 0) return [];

  const chunkIds = results.map(r => r.chunkId);
  const scoreMap = new Map(results.map(r => [r.chunkId, r.similarity]));

  const chunks = await prisma.bookChunk.findMany({
    where: { id: { in: chunkIds } },
    include: {
      book: { select: { id: true, title: true } },
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
      // Get embedding from Ollama
      const embedding = await queryOllamaEmbedding(
        chunkText,
        OLLAMA_BASE_URL,
        OLLAMA_EMBEDDING_MODEL
      );

      const chunk = await prisma.bookChunk.create({
        data: {
          bookId,
          chapter: section.title,
          contentType,
          contentText: chunkText,
          pageNumber: section.pageNumber,
          tokenCount: Math.ceil(chunkText.length / 4),
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

function classifySection(title: string, content: string): string {
  const combined = (title + ' ' + content).toLowerCase();
  if (/pest|insect|aphid|beetle|caterpillar/i.test(combined)) return 'pest';
  if (/disease|mold|blight|rot|powdery|fungus|rust/i.test(combined)) return 'disease';
  if (/compost|composting|organic matter/i.test(combined)) return 'composting';
  if (/planting|sow|seed|transplant|space|depth|harvest/i.test(combined)) return 'plant';
  if (/tip|advice|remember|note|warning|don't forget/i.test(combined)) return 'tip';
  if (/task|do this|apply|spray|prune|water|work/i.test(combined)) return 'task';
  return 'general';
}

function splitIntoChunks(text: string, chunkSize = 400, overlap = 50): string[] {
  const maxChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlapChars) + '\n' + para;
    } else {
      current += '\n' + para;
    }
  }

  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}
