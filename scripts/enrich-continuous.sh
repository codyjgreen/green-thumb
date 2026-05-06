#!/bin/bash
LOGFILE="/tmp/enrich-continuous.log"
STATEFILE="/tmp/enrich-continuous-idx.txt"
LOCKFILE="/tmp/enrich-continuous.lock"

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

START_IDX=0
[ -f "$STATEFILE" ] && START_IDX=$(cat "$STATEFILE")
echo "Starting from index $START_IDX" | tee -a "$LOGFILE"

cd /home/cody/green-thumb

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  echo "[$(date '+%H:%M:%S')] Batch $BATCH starting from idx=$START_IDX" | tee -a "$LOGFILE"
  
  DB_BEFORE=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=2 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$START_IDX \
  LIMIT=100 \
  node --import tsx scripts/enrich-progress.ts >> "$LOGFILE" 2>&1
  
  EXIT_CODE=$?
  
  DB_AFTER=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  ADDED=$((DB_AFTER - DB_BEFORE))
  echo "[$(date '+%H:%M:%S')] Batch $BATCH done. Exit:$EXIT_CODE | Added:$ADDED | DB:$DB_AFTER/$START_IDX" | tee -a "$LOGFILE"
  
  # Advance index by 2 (we process ~2 plants per run due to exit-after-2 issue)
  # But process 100 at a time in the script - we skip already-enriched ones
  # So we advance by 100 to skip past the ones we attempted
  START_IDX=$((START_IDX + 100))
  echo "$START_IDX" > "$STATEFILE"
  
  if [ "$DB_AFTER" -ge 2660 ]; then
    echo "ALL $DB_AFTER PLANTS DONE!" | tee -a "$LOGFILE"
    break
  fi
  
  if [ "$START_IDX" -ge 2661 ]; then
    echo "Index exhausted. DB=$DB_AFTER" | tee -a "$LOGFILE"
    # Check if we've actually exhausted all, or if we need to go back
    if [ "$ADDED" -eq 0 ]; then
      echo "No progress last batch. Possibly all remaining are duplicates. Resetting idx to 0 to check..." | tee -a "$LOGFILE"
      START_IDX=0
      echo "0" > "$STATEFILE"
      sleep 5
      continue
    fi
    break
  fi
  
  sleep 2
done

echo "Wrapper finished at $(date)" | tee -a "$LOGFILE"
