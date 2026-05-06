#!/bin/bash
# Continuously runs enrichment in 2-plant batches, advancing through the KB.
# Resumes from saved index after restart.
# Stops when all plants are enriched OR end of KB reached with no recent progress.

LOG="/tmp/enrich-stable.log"
IDXFILE="/tmp/enrich-stable-idx"
LOCKFILE="/tmp/enrich-stable.lock"
TOTAL_KB=2661  # Total entries in plant-knowledge-base.ts

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running, exit" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

# Resume from saved index
IDX=0
[ -f "$IDXFILE" ] && IDX=$(cat "$IDXFILE")
echo "[$(date '+%H:%M:%S')] Starting from KB index $IDX (DB: $(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null))" | tee "$LOG"

BATCH=0
CONSECUTIVE_EMPTY=0

while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null)
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | idx=$IDX | DB=$DB_BEFORE" >> "$LOG"
  
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=2 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$IDX \
  LIMIT=2 \
  node --import tsx scripts/enrich-progress.ts >> "$LOG" 2>&1
  
  DB_AFTER=$(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null)
  ADDED=$((DB_AFTER - DB_BEFORE))
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | Added:$ADDED | DB=$DB_BEFORE->$DB_AFTER | idx=$IDX" >> "$LOG"
  
  if [ "$ADDED" -gt 0 ]; then
    CONSECUTIVE_EMPTY=0
  else
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
    echo "Empty batch #$CONSECUTIVE_EMPTY at idx=$IDX" >> "$LOG"
  fi
  
  # Always advance by 2
  IDX=$((IDX + 2))
  echo "$IDX" > "$IDXFILE"
  
  # If we've gone past end of KB
  if [ "$IDX" -ge "$TOTAL_KB" ]; then
    echo "[$(date '+%H:%M:%S')] End of KB. Final check..." >> "$LOG"
    FINAL=$(node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null)
    echo "[$(date '+%H:%M:%S')] Final DB: $FINAL / $TOTAL_KB" >> "$LOG"
    
    if [ "$CONSECUTIVE_EMPTY" -ge 3 ]; then
      # All remaining plants were duplicates
      echo "All remaining plants are duplicates. DONE." >> "$LOG"
      break
    else
      # More plants to check, reset to 0
      echo "Resetting idx to 0 for another pass..." >> "$LOG"
      IDX=0
      CONSECUTIVE_EMPTY=0
      echo "0" > "$IDXFILE"
      sleep 5
      continue
    fi
  fi
  
  # If we've enriched all plants
  if [ "$DB_AFTER" -ge "$TOTAL_KB" ]; then
    echo "All $TOTAL_KB plants enriched! DONE." >> "$LOG"
    break
  fi
  
  sleep 1
done

echo "[$(date '+%H:%M:%S')] Wrapper finished." >> "$LOG"
