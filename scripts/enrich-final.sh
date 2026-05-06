#!/bin/bash
LOGFILE="/tmp/enrich-final.log"
STATEFILE="/tmp/enrich-final-idx.txt"
LOCKFILE="/tmp/enrich-final.lock"

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

START_IDX=0
[ -f "$STATEFILE" ] && START_IDX=$(cat "$STATEFILE")
echo "[$(date '+%H:%M:%S')] Starting from index $START_IDX" | tee "$LOGFILE"

TOTAL_IN_KB=$(node -e "
  import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
  console.log(PLANT_KNOWLEDGE_BASE.length);
" 2>/dev/null)
echo "KB has $TOTAL_IN_KB entries" | tee "$LOGFILE"

get_db_count() {
  node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null
}

BATCH=0
CONSECUTIVE_EMPTY=0
LAST_NEW_IDX=-1

while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(get_db_count)
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | idx=$START_IDX | DB=$DB_BEFORE" | tee -a "$LOGFILE"
  
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=2 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$START_IDX \
  LIMIT=2 \
  node --import tsx scripts/enrich-progress.ts >> "$LOGFILE" 2>&1
  
  EXIT_CODE=$?
  DB_AFTER=$(get_db_count)
  ADDED=$((DB_AFTER - DB_BEFORE))
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH done. Exit:$EXIT_CODE | Added:$ADDED | DB=$DB_AFTER | idx=$START_IDX" | tee -a "$LOGFILE"
  
  if [ "$ADDED" -eq 0 ]; then
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
    echo "Empty batch #$CONSECUTIVE_EMPTY at idx=$START_IDX" | tee -a "$LOGFILE"
    
    # If we got new plants at this index before, remember it
    if [ "$LAST_NEW_IDX" -eq "$START_IDX" ]; then
      echo "Same idx=$START_IDX had new plants before. Still waiting..." | tee -a "$LOGFILE"
    fi
  else
    LAST_NEW_IDX=$START_IDX
    CONSECUTIVE_EMPTY=0
  fi
  
  # Check if we've made no progress at the SAME index 5 times in a row
  if [ "$CONSECUTIVE_EMPTY" -ge 5 ] && [ "$LAST_NEW_IDX" -ne "$START_IDX" ]; then
    echo "No progress at idx=$START_IDX for 5 consecutive batches. Checking remaining..." | tee -a "$LOGFILE"
    REMAINING=$(node -e "
      import { PrismaClient } from '@prisma/client';
      import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
      const p = new PrismaClient();
      p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries\`.then(rows => {
        const inDb = new Set(rows.map((r: any) => r.scientificName));
        const notInDb = PLANT_KNOWLEDGE_BASE.filter((pl: any) => !inDb.has(pl.scientificName));
        console.log('Remaining unprocessed:', notInDb.length, 'of', PLANT_KNOWLEDGE_BASE.length);
        if (notInDb.length > 0) {
          console.log('Next 5:', notInDb.slice(0,5).map((p: any) => p.commonName).join(', '));
        }
        p.\$disconnect();
      });
    " 2>/dev/null >> "$LOGFILE")
    echo "Restarting from idx=0 to catch skipped plants..." | tee -a "$LOGFILE"
    START_IDX=0
    CONSECUTIVE_EMPTY=0
    LAST_NEW_IDX=-1
    echo "0" > "$STATEFILE"
    sleep 3
    continue
  fi
  
  # Always advance by 2
  OLD_IDX=$START_IDX
  START_IDX=$((START_IDX + 2))
  
  if [ "$START_IDX" -ge "$TOTAL_IN_KB" ]; then
    echo "End of KB (idx=$START_IDX >= $TOTAL_IN_KB). All plants checked." | tee -a "$LOGFILE"
    echo "[$(date '+%H:%M:%S')] Final DB count: $(get_db_count)" | tee -a "$LOGFILE"
    echo "DONE"
    break
  fi
  
  echo "$START_IDX" > "$STATEFILE"
  
  if [ "$DB_AFTER" -ge "$TOTAL_IN_KB" ]; then
    echo "All $TOTAL_IN_KB plants enriched! DB: $DB_AFTER" | tee -a "$LOGFILE"
    break
  fi
  
  # Small delay
  sleep 1
done
