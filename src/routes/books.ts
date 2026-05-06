import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../lib/http-errors.js';
import { extractTextFromFile } from '../services/extractor.js';
import { fetchArticleText } from '../services/web.js';
import { chunkAndEmbed } from '../services/search.js';
import { createJob, updateJob, getJob } from '../lib/jobs.js';
import { emitEvent } from '../services/webhooks.js';
import { incHttpRequest, observeHttpDuration } from '../lib/metrics.js';

const ALLOWED_TYPES = new Set(['application/pdf', 'application/epub+zip', 'text/plain']);

// ─── SSE clients registry ───────────────────────────────────────────
const sseClients = new Map<string, Set<(data: object) => void>>();

function emit(jobId: string, data: object) {
  const send = sseClients.get(jobId);
  console.log(`[SSE] Emitting to ${jobId}:`, JSON.stringify(data));
  if (!send || send.size === 0) {
    console.log(`[SSE] No clients connected for job ${jobId}`);
    return;
  }
  for (const fn of send) {
    try { fn(data); } catch { /* client gone */ }
  }
}

// ─── Shared Background Ingest ──────────────────────────────────────
async function ingestExtractedContent(
  jobId: string,
  title: string,
  author: string | null,
  filePath: string,
  fileType: string,
  fileSize: number,
  sections: { title: string; content: string; pageNumber?: number }[],
  prisma: FastifyInstance['prisma'],
  config: FastifyInstance['config'],
) {
  try {
    // Deduplicate: skip if a non-deleted book with the same title/author/fileType already exists
    const existing = await prisma.book.findFirst({
      where: {
        deletedAt: null,
        title,
        author: author ?? null,
        fileType,
      },
    });
    if (existing) {
      updateJob(jobId, {
        status: 'failed',
        stageLabel: `Skipped: a book "${title}" is already ingested (id: ${existing.id})`,
        error: `Duplicate book: "${title}" by ${author ?? 'unknown'} is already in the library.`,
      });
      emit(jobId, { stage: 'failed', label: 'Duplicate book skipped', error: `A book "${title}" is already ingested.` });
      return;
    }

    const book = await prisma.book.create({
      data: {
        title,
        author,
        filePath,
        fileType,
        fileSize,
        processedAt: new Date(),
      },
    });

    updateJob(jobId, { bookId: book.id, title: book.title });

    const totalSections = sections.length;
    updateJob(jobId, {
      status: 'chunking',
      stageLabel: 'Splitting into chunks...',
      totalSections,
      processedSections: 0,
    });
    emit(jobId, { stage: 'chunking', label: 'Splitting into chunks...', totalSections, current: 0 });

    const chunks = await chunkAndEmbed(
      prisma,
      config,
      book.id,
      sections,
      (current, total) => {
        updateJob(jobId, {
          status: 'embedding',
          stageLabel: `Embedding chunks ${current}/${total}...`,
          totalChunks: total,
          processedChunks: current,
        });
        emit(jobId, {
          stage: 'embedding',
          label: `Embedding chunks ${current}/${total}...`,
          totalChunks: total,
          currentChunks: current,
        });
      }
    );

    updateJob(jobId, {
      status: 'done',
      stageLabel: `Done! ${chunks.length} chunks indexed`,
      totalChunks: chunks.length,
      processedChunks: chunks.length,
    });
    emit(jobId, {
      stage: 'done',
      label: `Done! ${chunks.length} chunks indexed`,
      totalChunks: chunks.length,
      currentChunks: chunks.length,
    });

    emitEvent(prisma, 'book.uploaded', { book });
  } catch (err: any) {
    console.error(`[Ingest] Job ${jobId} failed:`, err);
    updateJob(jobId, {
      status: 'failed',
      stageLabel: `Error: ${err.message || err}`,
      error: String(err.message || err),
    });
    emit(jobId, { stage: 'failed', label: 'Ingest failed', error: String(err.message || err) });
  } finally {
    setTimeout(() => { sseClients.delete(jobId); }, 10000);
  }
}

// ─── File-based Ingest ──────────────────────────────────────────────
async function processFileIngestion(
  jobId: string,
  fullPath: string,
  ext: string,
  prisma: FastifyInstance['prisma'],
  config: FastifyInstance['config'],
) {
  try {
    const fileSize = statSync(fullPath).size;

    updateJob(jobId, {
      status: 'extracting',
      stageLabel: 'Extracting text from file...',
    });
    emit(jobId, { stage: 'extracting', label: 'Extracting text from file...' });

    const { title, author, sections } = await extractTextFromFile(fullPath, ext);
    const relPath = fullPath.replace(process.cwd() + '/', '');

    await ingestExtractedContent(jobId, title, author ?? null, relPath, ext, fileSize, sections, prisma, config);
  } catch (err: any) {
    updateJob(jobId, { status: 'failed', error: err.message });
    emit(jobId, { stage: 'failed', error: err.message });
  }
}

// ─── URL-based Ingest ───────────────────────────────────────────────
export async function processUrlIngestion(
  jobId: string,
  url: string,
  prisma: FastifyInstance['prisma'],
  config: FastifyInstance['config'],
) {
  try {
    updateJob(jobId, {
      status: 'extracting',
      stageLabel: 'Fetching and cleaning web content...',
    });
    emit(jobId, { stage: 'extracting', label: 'Fetching and cleaning web content...' });

    const article = await fetchArticleText(url);
    const sections = [{ title: 'Main Content', content: article.content }];

    await ingestExtractedContent(
      jobId, 
      article.title, 
      'Web Article', 
      url, 
      'web', 
      article.content.length, 
      sections, 
      prisma, 
      config
    );
  } catch (err: any) {
    updateJob(jobId, { status: 'failed', error: err.message });
    emit(jobId, { stage: 'failed', error: err.message });
  }
}

export async function registerBookRoutes(app: FastifyInstance) {
  // Hook to track HTTP metrics for all book routes
  app.addHook('onResponse', async (request, reply) => {
    const path = request.routeOptions?.url ?? request.url;
    incHttpRequest(request.method, path, reply.statusCode);
    if (request.startTime) {
      const duration = Number(process.hrtime.bigint() - request.startTime) / 1_000_000;
      observeHttpDuration(request.method, path, reply.statusCode, duration);
    }
  });

  // GET /books
  app.get('/books', {
    schema: {
      description: 'List all ingested books',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    const books = await app.prisma.book.findMany({
      where: { deletedAt: null },
      select: {
        id: true, title: true, author: true,
        fileType: true, fileSize: true,
        uploadedAt: true, processedAt: true,
        _count: { select: { chunks: true } },
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return {
      items: books.map(b => ({ ...b, chunkCount: b._count.chunks })),
      total: books.length,
    };
  });

  // GET /books/:bookId
  app.get('/books/:bookId', {
    schema: {
      description: 'Get details for a specific book',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { bookId: { type: 'string' } },
        required: ['bookId'],
      },
    },
  }, async (request) => {
    const { bookId } = z.object({ bookId: z.string() }).parse(request.params);

    const book = await app.prisma.book.findUnique({
      where: { id: bookId, deletedAt: null },
      select: {
        id: true, title: true, author: true,
        fileType: true, fileSize: true,
        uploadedAt: true, processedAt: true,
        _count: { select: { chunks: true } },
      },
    });

    if (!book) throw notFound('Book not found');
    return { ...book, chunkCount: book._count.chunks };
  });

  // GET /books/jobs/:jobId — SSE stream for ingest progress
  app.get('/books/jobs/:jobId', async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) return;
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);
    console.log(`[SSE] Client connecting for job ${jobId}`);

    const job = getJob(jobId);
    if (!job) throw notFound('Ingest job not found');

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': request.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    };
    reply.raw.writeHead(200, headers);
    reply.raw.flushHeaders();

    function send(data: object) {
      try {
        console.log(`[SSE] Sending to client ${jobId}:`, JSON.stringify(data));
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        console.error(`[SSE] Send failed for ${jobId}:`, err);
      }
    }

    // Send current state immediately
    send({ stage: job.status, label: job.stageLabel });

    // Heartbeat
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    // Register this client
    if (!sseClients.has(jobId)) sseClients.set(jobId, new Set());
    sseClients.get(jobId)!.add(send);
    console.log(`[SSE] Client registered for ${jobId}. Total clients: ${sseClients.get(jobId)!.size}`);

    // Keep handler alive until client disconnects
    // Fastify v5 will not close reply.raw while this promise is pending
    await new Promise<void>((resolve) => {
      request.raw.on('close', () => {
        console.log(`[SSE] Client disconnected for ${jobId}`);
        clearInterval(heartbeat);
        sseClients.get(jobId)?.delete(send);
        resolve();
      });
    });
  });

  // POST /books/upload
  app.post('/books/upload', {
    schema: {
      description: 'Upload and ingest a gardening book (PDF, EPUB, TXT)',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const data = await request.file();

    if (!data) throw badRequest('No file uploaded');

    const mimeType = data.mimetype;
    if (!ALLOWED_TYPES.has(mimeType)) {
      throw badRequest(`Unsupported file type: ${mimeType}. Supported: PDF, EPUB, TXT`);
    }

    const ext = mimeType === 'application/epub+zip' ? 'epub'
      : mimeType === 'application/pdf' ? 'pdf' : 'txt';

    const fileId = randomUUID();
    const filePath = join('uploads', `${fileId}.${ext}`);
    const fullPath = join(process.cwd(), filePath);

    // 1. Create job ID
    const jobId = randomUUID();
    createJob(jobId);

    // 2. Save file and start background process
    try {
      await pipeline(data.file, createWriteStream(fullPath));
      
      // Start background process
      processFileIngestion(jobId, fullPath, ext, app.prisma, app.config);

      reply.code(202);
      return {
        jobId,
        status: 'processing',
        message: 'File uploaded. Ingest started in background.',
      };
    } catch (err: any) {
      console.error(`[Upload] Failed to save file:`, err);
      throw badRequest(`Failed to save file: ${err.message}`);
    }
  });

  // POST /books/url — Ingest from a URL
  app.post('/books/url', {
    schema: {
      description: 'Fetch and ingest a gardening article from a URL',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
        },
      },
    },
  }, async (request, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(request.body);

    const jobId = randomUUID();
    createJob(jobId);

    // Start background process
    processUrlIngestion(jobId, url, app.prisma, app.config);

    reply.code(202);
    return {
      jobId,
      status: 'processing',
      message: 'URL ingestion started in background.',
    };
  });

  // DELETE /books/:bookId
  app.delete('/books/:bookId', {
    schema: {
      description: 'Delete a book and all its extracted chunks',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { bookId: { type: 'string' } },
        required: ['bookId'],
      },
    },
  }, async (request) => {
    const { bookId } = z.object({ bookId: z.string() }).parse(request.params);

    const book = await app.prisma.book.findUnique({ where: { id: bookId, deletedAt: null } });
    if (!book) throw notFound('Book not found');

    // Soft delete — marks as deleted without removing data
    await app.prisma.book.update({
      where: { id: bookId },
      data: { deletedAt: new Date() },
    });

    emitEvent(app.prisma, 'book.deleted', { bookId, book });
    return { deleted: true, bookId };
  });
}

