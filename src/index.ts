import { loadEnvFile } from './lib/env.js';
import { buildApp } from './app.js';
import { loadConfig } from './lib/config.js';

// Load .env file before anything else
loadEnvFile();

const config = loadConfig();
const app = buildApp(config);

const address = await app.listen({
  port: config.API_PORT,
  host: '0.0.0.0',
});

app.log.info(`Green-Thumb API ready at ${address}`);
app.log.info(`API docs available at ${address}/docs`);
