/**
 * In-memory metrics store for Prometheus-style exposition.
 * No external dependencies.
 */

// ─── Histogram bucket boundaries (ms) ───────────────────────────────
export const HISTOGRAM_BUCKETS = [10, 25, 50, 100, 250, 500, 1000] as const;

// ─── Metric: HTTP requests total (counter by method + path + status) ──
type HttpRequestsKey = `${string}:${string}:${string}`; // method:path:status
const httpRequestsTotal = new Map<HttpRequestsKey, number>();

// ─── Metric: HTTP request duration (histogram) ────────────────────────
type HttpDurationKey = `${string}:${string}:${string}`; // method:path:status
const httpDurationHistogram = new Map<HttpDurationKey, Map<number, number>>(); // key -> bucketIdx -> count
const httpDurationSummary   = new Map<HttpDurationKey, { sum: number; count: number }>(); // key -> {sum, count}

// ─── Metric: Ollama embedding requests (counter by cache hit/miss) ───
const ollamaEmbeddingTotal = new Map<string, number>(); // "hit" | "miss" -> count

// ─── Metric: Webhook fires (counter by event + status) ───────────────
type WebhookFireKey = `${string}:${'success' | 'failure'}`;
const webhookFiresTotal = new Map<WebhookFireKey, number>();

// ─── Public increment helpers ───────────────────────────────────────

/**
 * Increment HTTP requests counter.
 */
export function incHttpRequest(method: string, path: string, status: number): void {
  const key = `${method}:${path}:${status}` as HttpRequestsKey;
  httpRequestsTotal.set(key, (httpRequestsTotal.get(key) ?? 0) + 1);
}

/**
 * Observe HTTP request duration and record in histogram.
 */
export function observeHttpDuration(method: string, path: string, status: number, durationMs: number): void {
  const key = `${method}:${path}:${status}` as HttpDurationKey;

  if (!httpDurationHistogram.has(key)) {
    // Initialize all buckets to 0
    const buckets = new Map<number, number>();
    for (let i = 0; i <= HISTOGRAM_BUCKETS.length; i++) {
      buckets.set(i, 0);
    }
    httpDurationHistogram.set(key, buckets);
  }

  const buckets = httpDurationHistogram.get(key)!;

  for (let i = 0; i <= HISTOGRAM_BUCKETS.length; i++) {
    if (i === HISTOGRAM_BUCKETS.length) {
      // +Inf bucket always increments
      buckets.set(i, buckets.get(i)! + 1);
    } else if (durationMs <= HISTOGRAM_BUCKETS[i]) {
      buckets.set(i, buckets.get(i)! + 1);
    }
  }

  // Accumulate sum and count for histogram
  const existing = httpDurationSummary.get(key) ?? { sum: 0, count: 0 };
  httpDurationSummary.set(key, { sum: existing.sum + durationMs, count: existing.count + 1 });
}

/**
 * Increment Ollama embedding counter (cache hit or miss).
 */
export function incOllamaEmbedding(cacheStatus: 'hit' | 'miss'): void {
  ollamaEmbeddingTotal.set(cacheStatus, (ollamaEmbeddingTotal.get(cacheStatus) ?? 0) + 1);
}

/**
 * Increment webhook fire counter.
 */
export function incWebhookFire(event: string, status: 'success' | 'failure'): void {
  const key = `${event}:${status}` as WebhookFireKey;
  webhookFiresTotal.set(key, (webhookFiresTotal.get(key) ?? 0) + 1);
}

// ─── Prometheus exposition format ───────────────────────────────────

function formatCounter(name: string, help: string, type: string, labels: Record<string, string>, value: number): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}{${labelStr}} ${value}\n`;
}

function formatGauge(name: string, help: string, type: string, labels: Record<string, string>, value: number): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}{${labelStr}} ${value}\n`;
}

/**
 * Render all metrics in Prometheus text format.
 * Gauges (plant_entries_total, books_total, webhook_subscriptions_total) are
 * queried from the database at call time.
 */
export function renderMetrics(
  getPlantCount: () => Promise<number>,
  getBookCount: () => Promise<number>,
  getWebhookSubCount: () => Promise<number>,
): string {
  const lines: string[] = [];

  // HTTP requests total
  for (const [key, count] of httpRequestsTotal) {
    const [method, path, status] = key.split(':');
    lines.push(formatCounter(
      'green_thumb_http_requests_total',
      'Total HTTP requests',
      'counter',
      { method, path, status },
      count,
    ));
  }

  // HTTP request duration histogram
  for (const [key, buckets] of httpDurationHistogram) {
    const [method, path, status] = key.split(':');

    for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
      lines.push(formatCounter(
        'green_thumb_http_request_duration_ms_bucket',
        'HTTP request duration in ms',
        'histogram',
        { method, path, status, le: String(HISTOGRAM_BUCKETS[i]) },
        buckets.get(i) ?? 0,
      ));
    }
    // +Inf bucket
    lines.push(formatCounter(
      'green_thumb_http_request_duration_ms_bucket',
      'HTTP request duration in ms',
      'histogram',
      { method, path, status, le: '+Inf' },
      buckets.get(HISTOGRAM_BUCKETS.length) ?? 0,
    ));

    // Sum and count for histogram (required by Prometheus)
    const summary = httpDurationSummary.get(key) ?? { sum: 0, count: 0 };
    lines.push(formatCounter(
      'green_thumb_http_request_duration_ms_sum',
      'HTTP request duration sum in ms',
      'histogram',
      { method, path, status },
      summary.sum,
    ));
    lines.push(formatCounter(
      'green_thumb_http_request_duration_ms_count',
      'HTTP request duration count',
      'histogram',
      { method, path, status },
      summary.count,
    ));
  }

  // Ollama embedding requests
  for (const [cacheStatus, count] of ollamaEmbeddingTotal) {
    lines.push(formatCounter(
      'green_thumb_ollama_embedding_requests_total',
      'Total Ollama embedding requests',
      'counter',
      { cache: cacheStatus },
      count,
    ));
  }

  // Webhook fires
  for (const [key, count] of webhookFiresTotal) {
    const [event, status] = key.split(':');
    lines.push(formatCounter(
      'green_thumb_webhook_fires_total',
      'Total webhook fires',
      'counter',
      { event, status },
      count,
    ));
  }

  return lines.join('\n');
}
