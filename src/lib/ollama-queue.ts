/**
 * Ollama Request Queue — concurrency limiting and queuing per model.
 *
 * Uses a semaphore pattern with Promise-based waiting.
 * A singleton queue per model ensures that `nomic-embed-text` and `gemma4:latest`
 * never block each other.
 */

import { loadConfig } from './config.js';

interface QueueConfig {
  maxConcurrent: number;   // max simultaneous Ollama calls per model (default: 2)
  maxQueue: number;        // max queued requests per model (default: 50)
  minGapMs: number;        // minimum ms between calls to same model (default: 0)
  timeoutMs: number;       // per-request timeout (default: 120000)
}

interface PendingRequest<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  model: string;
  enqueuedAt: number;
  timeoutMs: number;
}

interface ModelQueue {
  running: number;
  lastCallStarted: number;
  queue: PendingRequest<any>[];
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_CONFIG: Required<QueueConfig> = {
  maxConcurrent: 2,
  maxQueue: 50,
  minGapMs: 0,
  timeoutMs: 120000,
};

// Per-model queues
const queues = new Map<string, ModelQueue>();

// Live config overlay — loaded fresh so env changes take effect without restart
function getConfig(): Required<QueueConfig> {
  try {
    const config = loadConfig();
    return {
      maxConcurrent: config.OLLAMA_MAX_CONCURRENT ?? DEFAULT_CONFIG.maxConcurrent,
      maxQueue: config.OLLAMA_QUEUE_MAX ?? DEFAULT_CONFIG.maxQueue,
      minGapMs: config.OLLAMA_MIN_GAP_MS ?? DEFAULT_CONFIG.minGapMs,
      timeoutMs: config.OLLAMA_REQUEST_TIMEOUT_MS ?? DEFAULT_CONFIG.timeoutMs,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function getOrCreateQueue(model: string): ModelQueue {
  if (!queues.has(model)) {
    queues.set(model, { running: 0, lastCallStarted: 0, queue: [] });
  }
  return queues.get(model)!;
}

function dequeueNext<T>(modelQueue: ModelQueue, model: string): void {
  const config = getConfig();

  if (modelQueue.queue.length === 0) {
    modelQueue.running--;
    return;
  }

  const next = modelQueue.queue.shift()!;
  const gap = config.minGapMs > 0
    ? Math.max(0, config.minGapMs - (Date.now() - modelQueue.lastCallStarted))
    : 0;

  setTimeout(async () => {
    modelQueue.lastCallStarted = Date.now();
    modelQueue.running++;

    const timeout = setTimeout(() => {
      next.reject(new Error('Ollama request timed out'));
      modelQueue.running--;
      dequeueNext(modelQueue, model);
    }, next.timeoutMs);

    try {
      const result = await next.fn();
      clearTimeout(timeout);
      next.resolve(result);
    } catch (err) {
      clearTimeout(timeout);
      next.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Decrement running first — dequeueNext only touches running when queue empties
      modelQueue.running--;
      dequeueNext(modelQueue, model);
    }
  }, gap);
}

/**
 * Enqueue an Ollama request, respecting concurrency limits.
 *
 * - If the queue for this model has room, the request is added and we wait our turn.
 * - If the queue is already full, immediately rejects with 'Ollama queue full'.
 * - On timeout, rejects with 'Ollama request timed out'.
 */
export function ollamaEnqueue<T>(
  model: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const config = getConfig();
  const effectiveTimeout = timeoutMs ?? config.timeoutMs;
  const modelQueue = getOrCreateQueue(model);

  if (modelQueue.queue.length >= config.maxQueue) {
    return Promise.reject(new Error('Ollama queue full'));
  }

  return new Promise<T>((resolve, reject) => {
    modelQueue.queue.push({
      fn,
      resolve: resolve as (value: T) => void,
      reject,
      model,
      enqueuedAt: Date.now(),
      timeoutMs: effectiveTimeout,
    });

    if (modelQueue.running < config.maxConcurrent) {
      modelQueue.running++;
      const gap = config.minGapMs > 0
        ? Math.max(0, config.minGapMs - (Date.now() - modelQueue.lastCallStarted))
        : 0;

      setTimeout(() => {
        modelQueue.lastCallStarted = Date.now();

        const timer = setTimeout(() => {
          const idx = modelQueue.queue.findIndex(r => r.resolve === resolve);
          if (idx !== -1) {
            modelQueue.queue.splice(idx, 1);
            reject(new Error('Ollama request timed out'));
            dequeueNext(modelQueue, model);
          }
        }, effectiveTimeout);

        fn()
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          })
          .finally(() => {
            dequeueNext(modelQueue, model);
          });
      }, gap);
    }
  });
}

/**
 * Returns the current queue depth (pending + running) for a given model,
 * and the global maxConcurrent setting.
 */
export function getOllamaQueueStatus(model?: string): { queueDepth: number; maxConcurrent: number; running: number }[] {
  const config = getConfig();
  const models = model ? [model] : [...queues.keys()];
  return models.map(m => {
    const q = queues.get(m);
    return {
      queueDepth: q ? q.queue.length : 0,
      running: q ? q.running : 0,
      maxConcurrent: config.maxConcurrent,
    };
  });
}
