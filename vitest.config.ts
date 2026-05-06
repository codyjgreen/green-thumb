import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '../../src/lib/config.js': resolve(__dirname, 'src/lib/config.ts'),
      '../../src/services/extractor.js': resolve(__dirname, 'src/services/extractor.ts'),
      '../../src/services/ollama.js': resolve(__dirname, 'src/services/ollama.ts'),
      '../../src/routes/auth.js': resolve(__dirname, 'src/routes/auth.ts'),
      '../../src/routes/search.js': resolve(__dirname, 'src/routes/search.ts'),
    },
    extensions: ['.ts', '.js'],
  },
});