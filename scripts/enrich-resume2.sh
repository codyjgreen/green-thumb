#!/bin/bash
LOGFILE="/tmp/enrich-resume2.log"
STATEFILE="/tmp/enrich-resume2-idx.txt"

# Check if already running
if [ -f "$STATEFILE.lock" ]; then
  OLD=$(cat "$STATEFILE.lock" 2>/dev/null)
  kill -0 "$OLD" 2>/dev/null && echo "Already running as $OLD" && exit 1
fi
echo $$ > "$STATEFILE.lock"
trap "rm -f $STATEFILE.lock" EXIT

START_IDX=0
[ -f "$STATEFILE" ] && START_IDX=$(cat "$STATEFILE")
echo "Starting from index $START_IDX" | tee -a "$LOGFILE"

cd /home/cody/green-thumb
BATCH=0
CONSECUTIVE_EMPTY=0

while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | idx=$START_IDX | DB=$DB_BEFORE" | tee -a "$LOGFILE"
  
  # Run exactly 2 plants at a time (known working batch size)
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=2 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$START_IDX \
  LIMIT=2 \
  node --import tsx scripts/enrich-progress.ts >> "$LOGFILE" 2>&1
  
  EXIT_CODE=$?
  
  DB_AFTER=$(node -e "
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
  " 2>/dev/null)
  
  ADDED=$((DB_AFTER - DB_BEFORE))
  echo "[$(date '+%H:%M:%S')] Batch $BATCH done. Exit:$EXIT_CODE | Added:$ADDED | DB=$DB_AFTER | idx=$START_IDX" | tee -a "$LOGFILE"
  
  if [ "$ADDED" -eq 0 ]; then
    CONSECUTIVE_EMPTY=$((CONSECUTIVE_EMPTY + 1))
    echo "[$(date '+%H:%M:%S')] Empty batch #$CONSECUTIVE_EMPTY" | tee -a "$LOGFILE"
    if [ "$CONSECUTIVE_EMPTY" -ge 3 ]; then
      echo "[$(date '+%H:%M:%S')] 3 consecutive empty batches. Checking all DB names..." | tee -a "$LOGFILE"
      # Check how many unique KB plants are in DB
      node -e "
        import { PrismaClient } from '@prisma/client';
        import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
        const p = new PrismaClient();
        p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries\`.then(rows => {
          const inDb = new Set(rows.map((r: any) => r.scientificName));
          const kbCount = PLANT_KNOWLEDGE_BASE.length;
          const inDbCount = inDb.size;
          const notInDb = PLANT_KNOWLEDGE_BASE.filter((pl: any) => !inDb.has(pl.scientificName)).length;
          console.log('KB total:', kbCount, 'In DB:', inDbCount, 'Not in DB:', notInDb);
          p.\$disconnect();
        });
      " 2>/dev/null >> "$LOGFILE"
      echo "[$(date '+%H:%M:%S')] Resetting idx to 0 to recheck..." | tee -a "$LOGFILE"
      START_IDX=0
      CONSECUTIVE_EMPTY=0
      sleep 5
    else
      START_IDX=$((START_IDX + 2))
    fi
  else
    CONSECUTIVE_EMPTY=0
    START_IDX=$((START_IDX + 2))
  fi
  
  echo "$START_IDX" > "$STATEFILE"
  
  if [ "$DB_AFTER" -ge 2660 ]; then
    echo "[$(date '+%H:%M:%S')] ALL 2660 PLANTS DONE!" | tee -a "$LOGFILE"
    break
  fi
  
  if [ "$START_IDX" -ge 2661 ]; then
    echo "[$(date '+%H:%M:%S')] End of KB. DB=$DB_AFTER. Resetting idx to 0." | tee -a "$LOGFILE"
    START_IDX=0
    CONSECUTIVE_EMPTY=0
    sleep 5
    continue
  fi
  
  # Small delay between batches
  sleep 1
done
