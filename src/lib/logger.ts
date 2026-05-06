/**
 * Structured logging utilities.
 *
 * Uses Fastify's built-in pino logger (enabled when NODE_ENV !== 'test').
 * Provides helpers for request-scoped logging and specific event types.
 *
 * Sensitive data rules (never log):
 * - Full JWT tokens
 * - Passwords
 * - API secrets
 * - Full plant content (truncate to 100 chars)
 */

import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

// Extend FastifyRequest to include our requestId
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    startTime?: bigint;
  }
}

/**
 * Generate a unique request ID.
 */
export function createRequestId(): string {
  return randomUUID();
}

/**
 * Truncate long strings (e.g., plant content) to a safe length for logging.
 */
export function truncateForLog(value: unknown, maxLen = 100): string {
  if (typeof value === 'string') {
    return value.length > maxLen ? value.slice(0, maxLen) + '...' : value;
  }
  return String(value).slice(0, maxLen);
}

/**
 * Build a safe log payload from a request.
 * Extracts userId from JWT payload if present (without logging the token itself).
 */
export function buildRequestLogData(request: FastifyRequest): {
  requestId: string;
  method: string;
  path: string;
  userAgent?: string;
  userId?: string;
} {
  return {
    requestId: request.requestId,
    method: request.method,
    path: request.url,
    userAgent: request.headers['user-agent'],
    userId: (request as any).user?.id,
  };
}

/**
 * Log a structured ingest event.
 */
export function logIngestEvent(
  logger: { info: Function; error: Function; warn: Function },
  event: 'start' | 'done' | 'error',
  data: {
    requestId?: string;
    jobId?: string;
    bookId?: string;
    error?: unknown;
    durationMs?: number;
  },
): void {
  const base = { event: `ingest.${event}`, ...data };
  if (event === 'error') {
    logger.error({ ...base, error: data.error instanceof Error ? data.error.message : String(data.error) });
  } else {
    logger.info(base);
  }
}

/**
 * Log a structured webhook event.
 */
export function logWebhookEvent(
  logger: { info: Function; error: Function },
  event: 'fire' | 'error',
  data: {
    requestId?: string;
    webhookId?: string;
    eventType?: string;
    url?: string;
    statusCode?: number;
    error?: unknown;
    durationMs?: number;
  },
): void {
  const base = { event: `webhook.${event}`, ...data };
  if (event === 'error') {
    logger.error({ ...base, error: data.error instanceof Error ? data.error.message : String(data.error) });
  } else {
    logger.info(base);
  }
}
