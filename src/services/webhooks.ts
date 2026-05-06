import { createHmac, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { incWebhookFire } from '../lib/metrics.js';
import { broadcast } from '../lib/broadcast.js';
import { isPrivateUrl } from './web.js';

export type WebhookSubscription = {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: Date;
  lastFireAt: Date | null;
  lastFireOk: boolean | null;
  failureCount: number;
};

const WEBHOOK_TIMEOUT_MS = parseInt(process.env['WEBHOOK_TIMEOUT_MS'] ?? '30000', 10);
const WEBHOOK_MAX_CONCURRENT = Number(process.env['WEBHOOK_MAX_CONCURRENT'] ?? 10);

/**
 * Generate HMAC-SHA256 signature of the payload using the subscription secret.
 */
export function signPayload(secret: string, payload: object): string {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Send a webhook POST to the subscription URL with retry on transient failures.
 * Retry schedule: immediate, 5s, 30s (3 attempts total).
 * Non-fatal — failures should not crash the caller.
 */
export async function sendWebhook(
  prisma: PrismaClient,
  subscription: WebhookSubscription,
  event: string,
  payload: object,
): Promise<void> {
  if (isPrivateUrl(subscription.url)) {
    console.error(`[Webhooks] SSRF blocked: ${subscription.url}`);
    return;
  }
  const signature = signPayload(subscription.secret, payload);
  const body = JSON.stringify(payload);

  const RETRY_DELAYS_MS = [0, 5_000, 30_000]; // immediate, 5s, 30s
  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Green-Thumb-Event': event,
          'X-Green-Thumb-Signature': signature,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      lastResponse = response;

      if (response.ok) {
        await prisma.webhookSubscription.update({
          where: { id: subscription.id },
          data: {
            lastFireAt: new Date(),
            lastFireOk: true,
            failureCount: 0,
          },
        });
        incWebhookFire(event, 'success');
        return; // Success — no need to retry
      }

      // 4xx errors are client errors — don't retry
      if (response.status >= 400 && response.status < 500) {
        await prisma.webhookSubscription.update({
          where: { id: subscription.id },
          data: {
            lastFireAt: new Date(),
            lastFireOk: false,
            failureCount: { increment: 1 },
          },
        });
        incWebhookFire(event, 'failure');
        return;
      }

      // 5xx are transient server errors — retry if attempts remain
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
    }
  }

  // All retries exhausted
  await prisma.webhookSubscription.update({
    where: { id: subscription.id },
    data: {
      lastFireAt: new Date(),
      lastFireOk: false,
      failureCount: { increment: 1 },
    },
  });
  incWebhookFire(event, 'failure');
}

/**
 * Look up all active subscriptions for a given event and fan out concurrently.
 * Uses Promise.allSettled so one failure doesn't affect others.
 * Webhook delivery is async/non-blocking.
 * Also broadcasts to all subscribed WebSocket clients.
 */
export function emitEvent(
  prisma: PrismaClient,
  event: string,
  payload: object,
): void {
  // Fire-and-forget — don't await
  void (async () => {
    try {
      const subscriptions = await prisma.webhookSubscription.findMany({
        where: {
          active: true,
          events: { has: event },
        },
      });

      const chunks = chunkArray(subscriptions, WEBHOOK_MAX_CONCURRENT);
      for (const batch of chunks) {
        await Promise.allSettled(
          batch.map((sub) => sendWebhook(prisma, sub as WebhookSubscription, event, payload)),
        );
      }
    } catch (err) {
      console.error(`[Webhooks] emitEvent(${event}) failed:`, err);
    }
  })();

  // Also broadcast to WebSocket clients (fire-and-forget)
  broadcast(event, payload);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Generate a random hex secret (32 bytes = 64 hex chars).
 */
export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}
