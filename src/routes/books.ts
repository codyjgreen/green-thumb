import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { badRequest, notFound } from '../lib/http-errors.js';
import { extractTextFromFile } from '../services/extractor.js';
import { chunkAndEmbed } from '../services/search.js';

const ALLOWED_TYPES = new Set(['application/pdf', 'application/epub+zip', 'text/plain']);

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

  // POST /books/upload
  app.post('/books/upload', {
    schema: {
      description: 'Upload and ingest a gardening book (PDF, EPUB, TXT). Extraction, chunking, and embedding happen automatically.',
      tags: ['books'],
      security: [{ bearerAuth: [] }],
      response: {
        201: {
          type: 'object',
          properties: {
            bookId: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
            chunksCreated: { type: 'number' },
          },
        },
      },
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

    await pipeline(data.file, createWriteStream(fullPath));

    // Get file size
    const { statSync } = await import('node:fs');
    const fileSize = statSync(fullPath).size;

    const { title, author, sections } = await extractTextFromFile(fullPath, ext);

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

    const chunks = await chunkAndEmbed(app.prisma, app.config, book.id, sections);

    reply.code(201);
    return {
      bookId: book.id,
      title: book.title,
      status: 'processed',
      chunksCreated: chunks.length,
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
