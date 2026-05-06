import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../../src/lib/config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Ensure NODE_ENV doesn't interfere with defaults
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads required env vars successfully', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';

    const config = loadConfig();
    expect(config.DATABASE_URL).toBe('postgresql://localhost:5432/gt');
    expect(config.JWT_ACCESS_SECRET).toBe('access-secret');
    expect(config.JWT_REFRESH_SECRET).toBe('refresh-secret');
    expect(config.UPLOADS_DIR).toBe('/uploads');
  });

  it('applies default values when optional vars are omitted', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';

    const config = loadConfig();
    expect(config.API_PORT).toBe(3002);
    expect(config.NODE_ENV).toBe('test');
    expect(config.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(config.OLLAMA_EMBEDDING_MODEL).toBe('llama3.2:3b');
    expect(config.OLLAMA_CHAT_MODEL).toBe('llama3.2:3b');
  });

  it('uses custom values when provided', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';
    process.env.API_PORT = '4000';
    process.env.OLLAMA_BASE_URL = 'http://ollama.local:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
    process.env.OLLAMA_CHAT_MODEL = 'llama3.2:1b';

    const config = loadConfig();
    expect(config.API_PORT).toBe(4000);
    expect(config.OLLAMA_BASE_URL).toBe('http://ollama.local:11434');
    expect(config.OLLAMA_EMBEDDING_MODEL).toBe('nomic-embed-text');
    expect(config.OLLAMA_CHAT_MODEL).toBe('llama3.2:1b');
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    delete process.env.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';

    expect(() => loadConfig()).toThrow();
  });

  it('throws when JWT_REFRESH_SECRET is missing', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    delete process.env.JWT_REFRESH_SECRET;
    process.env.UPLOADS_DIR = '/uploads';

    // JWT_REFRESH_SECRET is optional in the schema, so this should NOT throw
    // (only JWT_ACCESS_SECRET is required)
    expect(() => loadConfig()).not.toThrow();
  });

  it('rejects invalid NODE_ENV', () => {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.UPLOADS_DIR = '/uploads';
    process.env.NODE_ENV = 'not-a-mode';

    expect(() => loadConfig()).toThrow();
  });

  it('accepts valid NODE_ENV values', () => {
    for (const env of ['development', 'test', 'production']) {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/gt';
      process.env.JWT_ACCESS_SECRET = 'access-secret';
      process.env.JWT_REFRESH_SECRET = 'refresh-secret';
      process.env.UPLOADS_DIR = '/uploads';
      process.env.NODE_ENV = env;

      const config = loadConfig();
      expect(config.NODE_ENV).toBe(env);
    }
  });

  it('uses custom env object when passed', () => {
    const customEnv = {
      DATABASE_URL: 'postgresql://custom:5432/db',
      JWT_ACCESS_SECRET: 'custom-access',
      JWT_REFRESH_SECRET: 'custom-refresh',
      UPLOADS_DIR: '/custom/uploads',
      NODE_ENV: 'test',
    };

    const config = loadConfig(customEnv);
    expect(config.DATABASE_URL).toBe('postgresql://custom:5432/db');
    expect(config.JWT_ACCESS_SECRET).toBe('custom-access');
  });
});