import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { createHash } from 'node:crypto';

interface JwtPayload {
  userId: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function verifyApiKeyHash(fullKey: string, storedHash: string): boolean {
  const hash = createHash('sha256').update(fullKey).digest('hex');
  return hash === storedHash;
}

async function jwtPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: app.config.JWT_ACCESS_SECRET,
    sign: { expiresIn: '7d' },
  });

  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    const apiKey = request.headers['x-api-key'] as string | undefined;

    // 1. Try API key auth
    if (apiKey) {
      const keyPrefix = apiKey.slice(0, 12);
      if (keyPrefix.startsWith('gt_') && keyPrefix.length >= 10) {
        const candidates = await app.prisma.apiKey.findMany({
          where: { keyPrefix },
        });

        for (const candidate of candidates) {
          if (verifyApiKeyHash(apiKey, candidate.keyHash)) {
            // Check if key has write permissions for write operations
            const method = request.method;
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && candidate.permissions === 'read') {
              reply.code(403).send({
                statusCode: 403,
                message: `This API key has 'read' permissions only. Use a 'readwrite' key for ${method} operations.`,
              });
              return;
            }

            // Update lastUsedAt (fire and forget)
            app.prisma.apiKey.update({
              where: { id: candidate.id },
              data: { lastUsedAt: new Date() },
            }).catch((err) => console.warn('[Auth] Failed to update lastUsedAt:', err));

            // Attach auth info to request (both as auth object and as user for JWT-compatible routes)
            (request as any).auth = {
              type: 'api-key',
              apiKeyId: candidate.id,
              userId: candidate.userId,
              permissions: candidate.permissions,
            };
            // Also set request.user to satisfy JWT-expecting route handlers
            (request as any).user = { userId: candidate.userId };
            return; // Authenticated via API key
          }
        }
      }
    }

    // 2. Fall back to JWT Bearer token
    try {
      await request.jwtVerify();
      (request as any).auth = { type: 'jwt', userId: (request.user as JwtPayload).userId };
    } catch {
      reply.code(401).send({ statusCode: 401, message: 'Unauthorized — provide X-API-Key header or Bearer token' });
    }
  });
}

export default fp(jwtPlugin, { name: 'jwt', encapsulate: false });
