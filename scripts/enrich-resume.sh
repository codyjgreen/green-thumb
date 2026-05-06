#!/bin/bash
set -e
LOGFILE="/tmp/enrich-resume.log"
LOCKFILE="/tmp/enrich-resume.lock"
STATEFILE="/tmp/enrich-resume-state.txt"

# Exit if already running
if [ -f "$LOCKFILE" ]; then
  PID=$(cat "$LOCKFILE" 2>/dev/null)
  if kill -0 "$PID" 2>/dev/null; then
    echo "[$(date)] Already running as PID $PID" >> "$LOGFILE"
    exit 1
  fi
  echo "[$(date)] Stale lockfile, removing" >> "$LOGFILE"
fi

echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

START_IDX=0
if [ -f "$STATEFILE" ]; then
  START_IDX=$(cat "$STATEFILE")
fi

echo "[$(date)] Starting from index $START_IDX" >> "$LOGFILE"

cd /home/cody/green-thumb

while true; do
  # Check DB count
  DB_COUNT=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  echo "[$(date)] DB: $DB_COUNT plants | Next index: $START_IDX" >> "$LOGFILE"
  
  # Run enrichment from current index, limit 50 at a time
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=2 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$START_IDX \
  LIMIT=50 \
  node --import tsx scripts/enrich-progress.ts >> "$LOGFILE" 2>&1
  
  EXIT_CODE=$?
  
  # Count new plants added
  NEW_DB_COUNT=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  ADDED=$((NEW_DB_COUNT - DB_COUNT))
  
  echo "[$(date)] Run complete. Exit: $EXIT_CODE | Added: $ADDED | DB: $NEW_DB_COUNT" >> "$LOGFILE"
  
  if [ "$ADDED" -eq 0 ]; then
    # No progress - increment index by 50 and retry (some might be duplicates)
    # But also check if we've gone through all plants
    echo "[$(date)] No progress, incrementing index..." >> "$LOGFILE"
  fi
  
  # Update state
  START_IDX=$((START_IDX + 50))
  echo "$START_IDX" > "$STATEFILE"
  
  if [ "$NEW_DB_COUNT" -ge 2660 ]; then
    echo "[$(date)] ALL 2660 PLANTS ENRICHED!" >> "$LOGFILE"
    break
  fi
  
  if [ "$START_IDX" -ge 2661 ]; then
    echo "[$(date)] Exhausted KB without reaching 2660. DB: $NEW_DB_COUNT" >> "$LOGFILE"
    break
  fi
  
  echo "[$(date)] Sleeping 3s before next batch..." >> "$LOGFILE"
  sleep 3
done

echo "[$(date)] Wrapper finished. Final DB count: $(cat /tmp/enrich-state.txt 2>/dev/null || echo unknown)" >> "$LOGFILE"
