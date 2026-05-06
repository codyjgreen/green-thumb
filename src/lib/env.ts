import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnvFile(filePath = './.env') {
  // Resolve relative to the project root (two levels up from dist/lib), not cwd
  const distLib = dirname(fileURLToPath(import.meta.url));
  const absolutePath = resolve(distLib, '..', '..', filePath);

  if (!existsSync(absolutePath)) {
    return;
  }

  const fileContents = readFileSync(absolutePath, 'utf8');

  for (const rawLine of fileContents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
