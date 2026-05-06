#!/bin/bash
LOGFILE="/tmp/enrich-v3.log"
STATEFILE="/tmp/enrich-v3-idx.txt"
LOCKFILE="/tmp/enrich-v3.lock"

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

# Resume from saved index, or 0 if no state
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
SAME_IDX_EMPTY=0
LAST_SUCCESSFUL_IDX=-1

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
  
  if [ "$ADDED" -gt 0 ]; then
    LAST_SUCCESSFUL_IDX=$START_IDX
    SAME_IDX_EMPTY=0
    echo "Progress! idx=$START_IDX added $ADDED. DB=$DB_AFTER" | tee -a "$LOGFILE"
  else
    if [ "$LAST_SUCCESSFUL_IDX" -eq "$START_IDX" ]; then
      # Got empty batch at same idx where we made progress before
      SAME_IDX_EMPTY=$((SAME_IDX_EMPTY + 1))
      echo "Empty at idx=$START_IDX (#$SAME_IDX_EMPTY)" | tee -a "$LOGFILE"
    else
      # Different idx - just continue (might be duplicates ahead)
      SAME_IDX_EMPTY=0
    fi
  fi
  
  # Advance by 2
  START_IDX=$((START_IDX + 2))
  echo "$START_IDX" > "$STATEFILE"
  
  # If we hit end of KB, check if we're done
  if [ "$START_IDX" -ge "$TOTAL_IN_KB" ]; then
    echo "[$(date '+%H:%M:%S')] End of KB (idx=$START_IDX >= $TOTAL_IN_KB)" | tee -a "$LOGFILE"
    
    # One final sweep from 0 to catch any we skipped
    if [ "$SAME_IDX_EMPTY" -ge 3 ]; then
      echo "Last batches were empty - running final sweep from 0..." | tee -a "$LOGFILE"
      START_IDX=0
      SAME_IDX_EMPTY=0
      echo "0" > "$STATEFILE"
      sleep 5
      continue
    fi
    
    echo "[$(date '+%H:%M:%S')] Final count: $(get_db_count)" | tee -a "$LOGFILE"
    echo "DONE" | tee -a "$LOGFILE"
    break
  fi
  
  # If we have all plants, stop
  if [ "$DB_AFTER" -ge "$TOTAL_IN_KB" ]; then
    echo "All $TOTAL_IN_KB plants enriched! DB=$DB_AFTER" | tee -a "$LOGFILE"
    break
  fi
  
  # Fast delay between batches (don't overwhelm Ollama)
  sleep 1
done
