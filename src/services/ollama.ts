import { createHash } from 'node:crypto';
import { getRedisClient } from '../lib/redis.js';
import { loadConfig } from '../lib/config.js';
import { incOllamaEmbedding } from '../lib/metrics.js';
import { ollamaEnqueue } from '../lib/ollama-queue.js';

export interface OllamaEmbeddingResponse {
  embedding: number[];
}

export interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
}

/**
 * Get an embedding vector for a text string from the local Ollama instance.
 */
export async function queryOllamaEmbedding(
  text: string,
  baseUrl: string,
  model: string
): Promise<number[]> {
  const result = await ollamaEnqueue(model, async () => {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.statusText}`);
    }
    const data = (await response.json()) as OllamaEmbeddingResponse;
    return data.embedding;
  });
  return result;
}

/**
 * Get an embedding vector for a text string, with Redis caching.
 * Cache key is sha256(model + ":" + text).
 * Cache failures are non-fatal: falls back to direct Ollama call.
 */
export async function cachedQueryOllamaEmbedding(
  text: string,
  baseUrl: string,
  model: string
): Promise<number[]> {
  const hash = createHash('sha256').update(`${model}:${text}`).digest('hex');
  const cacheKey = `embed:${hash}`;

  try {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      incOllamaEmbedding('hit');
      return JSON.parse(cached) as number[];
    }
    incOllamaEmbedding('miss');
  } catch {
    // Redis unavailable or malformed data — fall through to Ollama
  }

  const embedding = await queryOllamaEmbedding(text, baseUrl, model);

  try {
    const redis = getRedisClient();
    const config = loadConfig();
    await redis.setex(cacheKey, config.EMBEDDING_CACHE_TTL_SECONDS, JSON.stringify(embedding));
  } catch {
    // Cache write failure is non-fatal
  }

  return embedding;
}

/**
 * Get a chat completion from the local Ollama instance.
 */
export async function queryOllamaChat(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const result = await ollamaEnqueue(model, async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama chat failed: ${response.statusText}`);
    }
    const data = (await response.json()) as OllamaChatResponse;
    return data.message.content;
  });
  return result;
}

/**
 * Stream a chat completion from the local Ollama instance.
 * Only the connection start is queued — the stream itself is not artificially delayed.
 */
export async function* streamOllamaChat(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): AsyncGenerator<string> {
  // Streaming is not queued — each stream holds a connection open for the duration,
  // so we let it bypass the semaphore to avoid blocking other requests.
  // The queue is only meaningful for request-throttling non-streaming calls.
  // NOTE: streaming requests bypass the concurrency queue (ollamaEnqueue) because each
  // stream holds a connection open for its duration. A queue here would serialize all streams,
  // defeating the purpose of streaming. A separate per-stream concurrency limit could be added
  // (e.g. a semaphore with maxConcurrentStreams=5) if Ollama becomes overwhelmed by many streams.
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: true,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is null');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          yield json.message.content;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }
}
