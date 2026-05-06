#!/bin/bash
# Fast wrapper: runs enrich-progress with LIMIT=50, which does 50 plants per batch
# The script skips already-enriched ones internally

LOG="/tmp/enrich-fast.log"
LOCKFILE="/tmp/enrich-fast.lock"
TOTAL_KB=2661

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

get_db() {
  node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null
}

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(get_db)
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | DB=$DB_BEFORE" | tee -a "$LOG"
  
  # Run 50 at a time (llama3.2 is ~1.6s each, 10 concurrent = ~8s per batch)
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=10 \
  OLLAMA_QUEUE_MAX=500 \
  LIMIT=50 \
  node --import tsx scripts/enrich-progress.ts >> "$LOG" 2>&1
  
  DB_AFTER=$(get_db)
  ADDED=$((DB_AFTER - DB_BEFORE))
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | Added:$ADDED | DB=$DB_BEFORE->$DB_AFTER" | tee -a "$LOG"
  
  if [ "$ADDED" -eq 0 ]; then
    REMAINING=$(node -e "
      import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
      import { PrismaClient } from '@prisma/client';
      const p = new PrismaClient();
      p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries WHERE \"scientificName\" IS NOT NULL\`.then(rows => {
        const inDb = new Set(rows.map((r: any) => r.scientificName));
        const remaining = PLANT_KNOWLEDGE_BASE.filter((pl: any) => !inDb.has(pl.scientificName));
        console.log(remaining.length + '/' + PLANT_KNOWLEDGE_BASE.length);
        if (remaining.length > 0) console.log('Next:', remaining[0].commonName, remaining[0].scientificName);
        p.\$disconnect();
      });
    " 2>/dev/null)
    echo "Remaining: $REMAINING" | tee -a "$LOG"
    if [ "$REMAINING" -eq 0 ]; then
      echo "ALL DONE! DB=$DB_AFTER" | tee -a "$LOG"
      break
    fi
    echo "Waiting 5s..." | tee -a "$LOG"
    sleep 5
  fi
  
  # Small delay
  sleep 1
done
