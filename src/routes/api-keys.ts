import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { notFound } from '../lib/http-errors.js';

const API_KEY_PREFIX = 'gt_';

// Generate a new random API key and return both the full key (shown once) and the hash
function generateApiKey(): { fullKey: string; hash: string; prefix: string } {
  const randomPart = randomBytes(24).toString('base64url'); // 32 char random string
  const fullKey = `${API_KEY_PREFIX}${randomPart}`;
  const hash = createHash('sha256').update(fullKey).digest('hex');
  const prefix = fullKey.slice(0, 12); // e.g. "gt_abc123xy"
  return { fullKey, hash, prefix };
}

// Verify an API key against stored hash
function verifyApiKey(fullKey: string, storedHash: string): boolean {
  const hash = createHash('sha256').update(fullKey).digest('hex');
  return hash === storedHash;
}

export async function registerApiKeyRoutes(app: FastifyInstance) {
  // GET /api-keys — list all API keys (name, prefix, permissions, lastUsed — never the key itself)
  app.get('/api-keys', {
    schema: {
      description: 'List all API keys (key value is never returned — only name, prefix, and permissions)',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => {
    const keys = await app.prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: keys, total: keys.length };
  });

  // POST /api-keys — create a new API key (only returns the full key ONCE)
  app.post('/api-keys', {
    schema: {
      description: 'Create a new API key. The full key is only returned once — save it immediately.',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, description: 'Friendly name for this key (e.g. \"Garden App v1\")' },
          permissions: { type: 'string', enum: ['read', 'readwrite'], default: 'read', description: '"read" = GET only, "readwrite" = GET + POST/PATCH/DELETE (but not admin ops)' },
        },
      },
    },
  }, async (request) => {
    const { name, permissions = 'read' } = z.object({
      name: z.string().min(1).max(100),
      permissions: z.enum(['read', 'readwrite']).default('read'),
    }).parse(request.body);

    // Generate the key — store hash, return full key once
    const { fullKey, hash, prefix } = generateApiKey();

    const apiKey = await app.prisma.apiKey.create({
      data: { name, keyHash: hash, keyPrefix: prefix, permissions },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      permissions: apiKey.permissions,
      // ONLY returned here — never again
      fullKey,
      message: 'Save this key now — it will not be shown again. Use it as: X-API-Key: <key>',
    };
  });

  // DELETE /api-keys/:id — revoke an API key
  app.delete('/api-keys/:id', {
    schema: {
      description: 'Revoke an API key permanently',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const key = await app.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw notFound('API key not found');

    // Ownership check: only the key's owner (or an admin) can delete it
    const userId = (request as any).user?.userId;
    if (key.userId && key.userId !== userId) {
      throw notFound('API key not found'); // Return 404 to avoid leaking key existence
    }

    await app.prisma.apiKey.delete({ where: { id } });

    return { deleted: true, id };
  });
}

// Middleware to authenticate via X-API-Key header (alternative to JWT)
// Tries API key first, falls back to JWT bearer token
export async function authenticateWithApiKey(
  request: any,
  reply: any,
  prisma: any
): Promise<{ userId: string | null; apiKeyId: string | null; permissions: string | null } | null> {
  const apiKeyHeader = request.headers['x-api-key'] as string | undefined;

  if (!apiKeyHeader) return null; // Let the route's auth handle JWT

  // Try to find the key by prefix first (fast path)
  const keyPrefix = apiKeyHeader.slice(0, 12);
  const candidates = await prisma.apiKey.findMany({
    where: { keyPrefix },
  });

  for (const candidate of candidates) {
    if (verifyApiKey(apiKeyHeader, candidate.keyHash)) {
      // Update lastUsedAt
      await prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      });
      return {
        userId: candidate.userId,
        apiKeyId: candidate.id,
        permissions: candidate.permissions,
      };
    }
  }

  return null; // Invalid key — fall through to JWT
}
