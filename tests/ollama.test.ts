// Ensure config is mocked before any module that uses it
vi.mock('../../src/lib/config.js', () => ({
  loadConfig: () => ({
    OLLAMA_MAX_CONCURRENT: 2,
    OLLAMA_QUEUE_MAX: 50,
    OLLAMA_MIN_GAP_MS: 0,
    OLLAMA_REQUEST_TIMEOUT_MS: 60000,
  }),
}));

// Mock ollama-queue to prevent real queue from blocking the tests
vi.mock('../../src/lib/ollama-queue.js', () => ({
  ollamaEnqueue: async (_model: string, fn: () => Promise<unknown>) => fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryOllamaEmbedding, queryOllamaChat, streamOllamaChat } from '../../src/services/ollama.js';

describe('ollama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queryOllamaEmbedding', () => {
    it('calls the correct endpoint with correct body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1, 0.2, 0.3] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const embedding = await queryOllamaEmbedding('test text', 'http://localhost:11434', 'llama3.2:3b');

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2:3b', prompt: 'test text' }),
      });
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it('returns the embedding array from response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.5, -0.3, 0.8, 0.1] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const embedding = await queryOllamaEmbedding('hello', 'http://ollama.local:11434', 'nomic-embed-text');

      expect(embedding).toHaveLength(4);
      expect(embedding).toContain(0.5);
    });

    it('throws when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        queryOllamaEmbedding('test', 'http://localhost:11434', 'llama3.2:3b')
      ).rejects.toThrow('Ollama embedding failed: Service Unavailable');
    });

    it('throws when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        queryOllamaEmbedding('test', 'http://localhost:11434', 'llama3.2:3b')
      ).rejects.toThrow('Network error');
    });

    it('uses custom base URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ embedding: [0.1] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await queryOllamaEmbedding('test', 'http://custom-ollama:11434', 'llama3');

      expect(mockFetch).toHaveBeenCalledWith('http://custom-ollama:11434/api/embeddings', expect.any(Object));
    });
  });

  describe('queryOllamaChat', () => {
    it('calls the correct endpoint with system and user messages', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: { role: 'assistant', content: 'Hello!' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const response = await queryOllamaChat(
        'http://localhost:11434',
        'llama3.2:3b',
        'You are a helpful assistant.',
        'What is gardening?'
      );

      // AbortSignal.timeout is non-serializable — use objectContaining
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is gardening?' },
          ],
          stream: false,
        }),
      }));
      expect(response).toBe('Hello!');
    });

    it('returns the message content from response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: { role: 'assistant', content: 'Plant tomatoes in sunlight.' } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const content = await queryOllamaChat('http://localhost:11434', 'llama3.2:3b', '', 'How do I grow tomatoes?');

      expect(content).toBe('Plant tomatoes in sunlight.');
    });

    it('throws when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Model not found',
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        queryOllamaChat('http://localhost:11434', 'nonexistent-model', '', 'Hello')
      ).rejects.toThrow('Ollama chat failed: Model not found');
    });

    it('throws when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        queryOllamaChat('http://localhost:11434', 'llama3', '', 'Hello')
      ).rejects.toThrow('Connection refused');
    });
  });

  describe('streamOllamaChat', () => {
    it('yields content tokens from streaming NDJSON response', async () => {
      const encoder = new TextEncoder();

      const mockStream = new ReadableStream({
        start(controller) {
          // Ollama streams raw NDJSON lines (not SSE with "data:" prefix)
          controller.enqueue(encoder.encode('{"message":{"content":"Hello"}}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":" "}}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"World"}}\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"!"}}\n'));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });
      vi.stubGlobal('fetch', mockFetch);

      const tokens: string[] = [];
      for await (const token of streamOllamaChat('http://localhost:11434', 'llama3.2:3b', '', '')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['Hello', ' ', 'World', '!']);
    });

    it('throws when response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
      });
      vi.stubGlobal('fetch', mockFetch);

      const gen = streamOllamaChat('http://localhost:11434', 'llama3.2:3b', '', '');
      await expect(gen.next()).rejects.toThrow('Ollama chat failed: Bad Request');
    });

    it('yields nothing on empty lines', async () => {
      const encoder = new TextEncoder();

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"Token"}}\n'));
          controller.enqueue(encoder.encode('\n'));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });
      vi.stubGlobal('fetch', mockFetch);

      const tokens: string[] = [];
      for await (const token of streamOllamaChat('http://localhost:11434', 'llama3.2:3b', '', '')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['Token']);
    });

    it('skips malformed JSON lines', async () => {
      const encoder = new TextEncoder();

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('not json\n'));
          controller.enqueue(encoder.encode('{"message":{"content":"Valid"}}\n'));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });
      vi.stubGlobal('fetch', mockFetch);

      const tokens: string[] = [];
      for await (const token of streamOllamaChat('http://localhost:11434', 'llama3.2:3b', '', '')) {
        tokens.push(token);
      }

      expect(tokens).toEqual(['Valid']);
    });

    it('uses correct endpoint and body', async () => {
      const encoder = new TextEncoder();

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"A"}}\n'));
          controller.close();
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockStream,
      });
      vi.stubGlobal('fetch', mockFetch);

      for await (const _ of streamOllamaChat('http://custom:11434', 'my-model', 'system prompt', 'user message')) {
        break;
      }

      // AbortSignal.timeout is non-serializable — use objectContaining
      expect(mockFetch).toHaveBeenCalledWith('http://custom:11434/api/chat', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'my-model',
          messages: [
            { role: 'system', content: 'system prompt' },
            { role: 'user', content: 'user message' },
          ],
          stream: true,
        }),
      }));
    });
  });
});