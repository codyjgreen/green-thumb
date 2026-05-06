import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required').optional(),
  UPLOADS_DIR: z.string().min(1, 'UPLOADS_DIR is required').default('./uploads'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('llama3.2:3b'),
  OLLAMA_CHAT_MODEL: z.string().default('llama3.2:3b'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  PERMAPEOPLE_KEY_ID: z.string().optional(),
  PERMAPEOPLE_KEY_SECRET: z.string().optional(),
  EMBEDDING_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  WS_PING_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

const queueSchema = z.object({
  OLLAMA_MAX_CONCURRENT: z.coerce.number().int().nonnegative().default(2),
  OLLAMA_QUEUE_MAX: z.coerce.number().int().positive().default(50),
  OLLAMA_MIN_GAP_MS: z.coerce.number().int().nonnegative().default(0),
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
});

const envSchema = baseSchema.merge(queueSchema);

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
