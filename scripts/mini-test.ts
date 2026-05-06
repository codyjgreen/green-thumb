import { PrismaClient } from '@prisma/client';
import { ollamaEnqueue } from '../src/lib/ollama-queue.js';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@localhost:4050/greenthumb' } },
});

async function seedOne(name: string) {
  process.stdout.write(`[${Date.now()}] Starting: ${name}\n`);
  try {
    const result = await ollamaEnqueue('gemma4:latest', async () => {
      const resp = await fetch('http://192.168.0.27:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma4:latest', messages: [{ role: 'user', content: 'Reply: ok' }], stream: false }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data.message.content;
    });
    process.stdout.write(`[${Date.now()}] Done: ${name}\n`);
  } catch(e) {
    process.stderr.write(`[${Date.now()}] ERROR ${name}: ${e}\n`);
  }
}

async function main() {
  process.stdout.write(`[${Date.now()}] Main start\n`);
  for (const name of ['Plant-A', 'Plant-B', 'Plant-C', 'Plant-D']) {
    await seedOne(name);
  }
  process.stdout.write(`[${Date.now()}] Loop done\n`);
  await prisma.$disconnect();
}

main().catch(e => { process.stderr.write(`FATAL: ${e}\n`); process.exit(1); });
process.stdout.write(`[${Date.now()}] Script initialized\n`);
