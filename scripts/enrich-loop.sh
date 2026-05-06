#!/bin/bash
# Wrapper that keeps enrich-all.ts running until all plants are processed
LOGFILE="/tmp/enrich-loop.log"
LAST_COUNT=0

for i in $(seq 1 1330); do
    DATABASE_URL=postgresql://postgres:postgres@localhost:4050/greenthumb \
    JWT_ACCESS_SECRET=test-jwt-access-secret-32chars!! \
    JWT_REFRESH_SECRET=test-jwt-refresh-secret-32chars!! \
    OLLAMA_MAX_CONCURRENT=2 \
    OLLAMA_QUEUE_MAX=500 \
    node --import tsx scripts/enrich-all.ts >> "$LOGFILE" 2>&1
    
    EXIT_CODE=$?
    CURRENT_COUNT=$(cd /home/cody/green-thumb && node -e "
        import { PrismaClient } from '@prisma/client';
        const p = new PrismaClient();
        p.plantEntry.count().then(c => { console.log(c); p.\$disconnect(); });
    " 2>/dev/null)
    
    echo "[$(date)] Run $i done. Exit: $EXIT_CODE, DB count: $CURRENT_COUNT (added $((CURRENT_COUNT - LAST_COUNT)))" >> "$LOGFILE"
    
    if [ "$CURRENT_COUNT" -ge 2660 ]; then
        echo "All 2660 plants enriched!" >> "$LOGFILE"
        break
    fi
    
    if [ "$CURRENT_COUNT" -eq "$LAST_COUNT" ]; then
        echo "No progress, waiting 5s before retry..." >> "$LOGFILE"
        sleep 5
    fi
    
    LAST_COUNT=$CURRENT_COUNT
    echo "Restarting for round $i... ($CURRENT_COUNT/2660 so far)" >> "$LOGFILE"
done

echo "Done! Final count: $CURRENT_COUNT" >> "$LOGFILE"
