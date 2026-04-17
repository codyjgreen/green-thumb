import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../lib/http-errors.js';
import { extractTextFromFile } from '../services/extractor.js';
import { chunkAndEmbed } from '../services/search.js';
import { createJob, updateJob, getJob, deleteJob, type IngestJob } from '../lib/jobs.js';

const ALLOWED_TYPES = new Set(['application/pdf', 'application/epub+zip', 'text/plain']);

// ─── SSE clients registry ───────────────────────────────────────────
const sseClients = new Map<string, Set<() => void>>();

function emit(jobId: string, data: object) {
  const send = sseClients.get(jobId);
  if (!send) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const close of send) {
    try { close(); } catch { /* client gone */ }
  }
}

// ─── Background ingest ──────────────────────────────────────────────
async function ingestBook(
  jobId: string,
  bookId: string,
  sections: { title: string; content: string; pageNumber?: number }[],
  prisma: FastifyInstance['prisma'],
  config: FastifyInstance['config'],
) {
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
    bookId,
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

  // Clean up SSE clients after a moment
  setTimeout(() => { sseClients.delete(jobId); }, 5000);
}

export async function registerBookRoutes(app: FastifyInstance) {
  // GET /books
  app.get('/books', {
    schema: {
      description: 'List all ingested books',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    const books = await app.prisma.book.findMany({
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
      where: { id: bookId },
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
    const { jobId } = z.object({ jobId: z.string() }).parse(request.params);

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
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch { /* client gone */ }
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

    // Keep handler alive until client disconnects
    // Fastify v5 will not close reply.raw while this promise is pending
    await new Promise<void>((resolve) => {
      request.raw.on('close', () => {
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

    // Save file
    updateJob; // hoisted
    reply.code(202);
    const jobId = randomUUID();
    const job = createJob(jobId);

    updateJob(jobId, {
      status: 'extracting',
      stageLabel: 'Saving and extracting text...',
    });
    emit(jobId, { stage: 'extracting', label: 'Saving and extracting text...' });

    await pipeline(data.file, createWriteStream(fullPath));

    const { statSync } = await import('node:fs');
    const fileSize = statSync(fullPath).size;

    let title: string;
    let author: string | undefined;
    let sections: { title: string; content: string; pageNumber?: number }[];

    try {
      const extracted = await extractTextFromFile(fullPath, ext);
      title = extracted.title;
      author = extracted.author;
      sections = extracted.sections;
    } catch (err) {
      updateJob(jobId, {
        status: 'failed',
        stageLabel: `Extraction failed: ${err}`,
        error: String(err),
      });
      emit(jobId, { stage: 'failed', label: 'Extraction failed', error: String(err) });
      throw badRequest(`Failed to extract text: ${err}`);
    }

    const book = await app.prisma.book.create({
      data: {
        title,
        author: author ?? null,
        filePath,
        fileType: ext,
        fileSize,
        processedAt: new Date(),
      },
    });

    updateJob(jobId, { bookId: book.id, title: book.title });

    // Start background ingest — don't await
    ingestBook(jobId, book.id, sections, app.prisma, app.config).catch(err => {
      updateJob(jobId, {
        status: 'failed',
        stageLabel: `Ingest failed: ${err.message}`,
        error: err.message,
      });
      emit(jobId, { stage: 'failed', label: 'Ingest failed', error: err.message });
    });

    return {
      jobId,
      bookId: book.id,
      title: book.title,
      status: 'processing',
      message: 'Book saved. Ingest started — track progress via the job SSE endpoint.',
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

    const book = await app.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw notFound('Book not found');

    await app.prisma.book.delete({ where: { id: bookId } });

    return { deleted: true, bookId };
  });
}
