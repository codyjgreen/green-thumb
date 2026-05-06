import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config FIRST
vi.mock('../../src/lib/config.js', () => ({
  loadConfig: () => ({
    OLLAMA_MAX_CONCURRENT: 2,
    OLLAMA_QUEUE_MAX: 50,
    OLLAMA_MIN_GAP_MS: 0,
    OLLAMA_REQUEST_TIMEOUT_MS: 60000,
  }),
}));

// Mock ollama-queue to prevent real queue
vi.mock('../../src/lib/ollama-queue.js', () => ({
  ollamaEnqueue: async (_model: string, fn: () => Promise<unknown>) => fn(),
}));

import { queryOllamaChat } from '../../src/services/ollama.js';

describe('ollama persistence check', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: { role: 'assistant', content: 'Hello!' } }),
    }));
  });

  it('chat test 1', async () => {
    const result = await queryOllamaChat('http://localhost:11434', 'llama3.2:3b', '', 'Hi');
    expect(result).toBe('Hello!');
  });

  it('chat test 2', async () => {
    const result = await queryOllamaChat('http://localhost:11434', 'llama3.2:3b', '', 'Hi');
    expect(result).toBe('Hello!');
  });
});
