#!/bin/bash
# Shuffle-based enrichment - processes unenriched plants randomly, no duplicates

LOG="/tmp/enrich-shuffle.log"
LOCKFILE="/tmp/enrich-shuffle.lock"

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

get_db() {
  node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries WHERE \"scientificName\" IS NOT NULL\`.then(rows => {
      console.log(JSON.stringify([...new Set(rows.map((r: any) => r.scientificName))]));
      p.\$disconnect();
    });
  " 2>/dev/null
}

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null)
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | DB=$DB_BEFORE" | tee -a "$LOG"
  
  # Run 10 plants at a time (llama3.2 is fast at 1.6s each)
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=10 \
  OLLAMA_QUEUE_MAX=500 \
  node --import tsx scripts/enrich-progress.sh >> "$LOG" 2>&1
  
  DB_AFTER=$(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null)
  ADDED=$((DB_AFTER - DB_BEFORE))
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | Added:$ADDED | DB=$DB_BEFORE->$DB_AFTER" | tee -a "$LOG"
  
  # If no progress, wait a bit (might be all done)
  if [ "$ADDED" -eq 0 ]; then
    echo "[$(date '+%H:%M:%S')] No progress - checking if done..." | tee -a "$LOG"
    REMAINING=$(node -e "
      import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
      import { PrismaClient } from '@prisma/client';
      const p = new PrismaClient();
      p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries WHERE \"scientificName\" IS NOT NULL\`.then(rows => {
        const inDb = new Set(rows.map((r: any) => r.scientificName));
        const remaining = PLANT_KNOWLEDGE_BASE.filter((pl: any) => !inDb.has(pl.scientificName));
        console.log(remaining.length + '/' + PLANT_KNOWLEDGE_BASE.length);
        p.\$disconnect();
      });
    " 2>/dev/null)
    echo "Remaining unenriched: $REMAINING" | tee -a "$LOG"
    if [ "$REMAINING" -eq 0 ]; then
      echo "ALL PLANTS ENRICHED! DB=$DB_AFTER" | tee -a "$LOG"
      break
    fi
    echo "Waiting 10s before retry..." | tee -a "$LOG"
    sleep 10
  fi
  
  sleep 1
done
