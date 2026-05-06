import { loadEnvFile } from './lib/env.js';
import { buildApp } from './app.js';
import { loadConfig } from './lib/config.js';

// Load .env file before anything else
loadEnvFile();

const config = loadConfig();

// Pre-warm Ollama embedding model so the first search isn't slow
async function warmupOllama(baseUrl: string, model: string): Promise<void> {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'warmup ping' }),
    });
    if (res.ok) {
      console.log(`[warmup] ${model} loaded in ${Date.now() - start}ms`);
    } else {
      console.warn(`[warmup] ${model} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[warmup] ${model} warmup request failed:`, err);
  }
}

await warmupOllama(config.OLLAMA_BASE_URL, config.OLLAMA_EMBEDDING_MODEL);

const app = buildApp(config);

const address = await app.listen({
  port: config.API_PORT,
  host: '0.0.0.0',
});

app.log.info(`Green-Thumb API ready at ${address}`);
app.log.info(`API docs available at ${address}/docs`);
