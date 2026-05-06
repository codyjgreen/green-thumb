#!/bin/bash
# Jump to first unenriched index and process forward
# Finds the first unenriched index, then processes in batches of 50

LOG="/tmp/enrich-jump.log"
LOCKFILE="/tmp/enrich-jump.lock"
TOTAL_KB=2661

[ -f "$LOCKFILE" ] && kill -0 "$(cat "$LOCKFILE")" 2>/dev/null && echo "Already running" && exit 1
echo $$ > "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

cd /home/cody/green-thumb

get_db() {
  node -e "import { PrismaClient } from '@prisma/client'; const p = new PrismaClient(); p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });" 2>/dev/null
}

find_first_unenriched_idx() {
  node --import tsx -e "
    import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
    import { PrismaClient } from '@prisma/client';
    const p = new PrismaClient();
    p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries WHERE \"scientificName\" IS NOT NULL\`.then(rows => {
      const inDb = new Set(rows.map((r: any) => r.scientificName));
      for (let i = 0; i < PLANT_KNOWLEDGE_BASE.length; i++) {
        if (!inDb.has(PLANT_KNOWLEDGE_BASE[i].scientificName)) {
          console.log(i);
          break;
        }
      }
      p.\$disconnect();
    });
  " 2>/dev/null
}

# Start from first unenriched index
IDX=$(find_first_unenriched_idx)
echo "[$(date '+%H:%M:%S')] First unenriched idx: $IDX" | tee "$LOG"

BATCH=0
while true; do
  BATCH=$((BATCH + 1))
  
  DB_BEFORE=$(get_db)
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | idx=$IDX | DB=$DB_BEFORE" | tee -a "$LOG"
  
  DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
  JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
  JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
  OLLAMA_MAX_CONCURRENT=10 \
  OLLAMA_QUEUE_MAX=500 \
  START_IDX=$IDX \
  LIMIT=50 \
  node --import tsx scripts/enrich-progress.ts >> "$LOG" 2>&1
  
  DB_AFTER=$(get_db)
  ADDED=$((DB_AFTER - DB_BEFORE))
  
  echo "[$(date '+%H:%M:%S')] Batch $BATCH | Added:$ADDED | DB=$DB_BEFORE->$DB_AFTER | idx=$IDX" | tee -a "$LOG"
  
  if [ "$ADDED" -eq 0 ]; then
    # Find next unenriched index
    NEXT=$(find_first_unenriched_idx)
    if [ -z "$NEXT" ] || [ "$NEXT" -eq "$IDX" ]; then
      echo "No more unenriched plants found. DONE! DB=$DB_AFTER" | tee -a "$LOG"
      break
    fi
    echo "Jumping from idx=$IDX to idx=$NEXT" | tee -a "$LOG"
    IDX=$NEXT
  else
    # Advance by 50
    IDX=$((IDX + 50))
  fi
  
  if [ "$DB_AFTER" -ge 2661 ]; then
    echo "ALL 2661 plants enriched!" | tee -a "$LOG"
    break
  fi
  
  if [ "$IDX" -ge "$TOTAL_KB" ]; then
    # Re-scan for any remaining
    REMAINING=$(node --import tsx -e "
      import { PLANT_KNOWLEDGE_BASE } from './scripts/plant-knowledge-base.js';
      import { PrismaClient } from '@prisma/client';
      const p = new PrismaClient();
      p.\$queryRaw\`SELECT \"scientificName\" FROM plant_entries WHERE \"scientificName\" IS NOT NULL\`.then(rows => {
        const inDb = new Set(rows.map((r: any) => r.scientificName));
        const notInDb = PLANT_KNOWLEDGE_BASE.filter((pl: any) => !inDb.has(pl.scientificName));
        console.log(notInDb.length);
        p.\$disconnect();
      });
    " 2>/dev/null)
    echo "End of KB, remaining: $REMAINING" | tee -a "$LOG"
    if [ "$REMAINING" -eq 0 ] || [ -z "$REMAINING" ]; then
      echo "All done! DB=$DB_AFTER" | tee -a "$LOG"
      break
    fi
    IDX=0
  fi
  
  sleep 1
done
