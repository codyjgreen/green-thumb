# Green-Thumb Setup

## Overview
RAG-based gardening knowledge base with pgvector embeddings, Ollama for inference, and a Fastify API. Designed to be the single source of truth for structured plant knowledge consumed by gardening apps.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        HOST (Ubuntu)                          │
│                                                               │
│  ┌─────────────┐   ┌─────────────────┐   ┌────────────────┐  │
│  │ Admin UI    │   │ API Server       │   │ Ollama         │  │
│  │ :4040       │──▶│ :4041           │──▶│ localhost:11434│  │
│  │ (static     │   │ (Fastify/Node)  │   │                │  │
│  │  HTML/JS)   │   │                 │   │ Models:        │  │
│  └─────────────┘   └─────────────────┘   │ - nomic-embed  │  │
│                                          │   (embeddings) │  │
│  ┌──────────────────────────────────┐   │ - gemma4:latest│  │
│  │ Docker Network: green-thumb-net   │   │   (chat)       │  │
│  │                                  │   └────────────────┘  │
│  │  ┌──────────────────────────┐   │                       │
│  │  │ green-thumb-db           │   │                       │
│  │  │ :4050 → container :5432  │   │                       │
│  │  │ pgvector/pg16            │   │                       │
│  │  │ DB: greenthumb           │   │                       │
│  │  │ User: postgres           │   │                       │
│  │  └──────────────────────────┘   │                       │
│  └──────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

## Services & Ports

| Service  | Host Port | Container Port | Process       | Notes                              |
|----------|-----------|---------------|---------------|-------------------------------------|
| Admin UI | 4040      | 80            | python3 http  | Static HTML (plants.html)           |
| API      | 4041      | 3000          | node/tsx      | Fastify API, serves /docs          |
| Database | 4050      | 5432          | docker/pg16   | pgvector extension, DB: greenthumb  |
| Ollama   | 11434     | 11434         | host-level    | Bound to 127.0.0.1 only            |

## Environment Variables (API)

```
NODE_ENV=development
API_PORT=4041
DATABASE_URL=postgresql://postgres:***@localhost:4050/greenthumb
JWT_ACCESS_SECRET=***
JWT_REFRESH_SECRET=***
UPLOADS_DIR=./uploads
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=gemma4:latest
```

## Starting the API

```bash
cd /home/cody/green-thumb
API_PORT=4041 DATABASE_URL="postgresql://postgres:postgres@localhost:4050/greenthumb" \
JWT_ACCESS_SECRET=your-secret JWT_REFRESH_SECRET=your-secret \
node --import tsx src/index.ts
```

## Starting the Admin UI

```bash
cd /home/cody/green-thumb/admin
python3 -m http.server 4040
# Then open http://192.168.0.102:4040/plants.html
```

## Database

- User: postgres
- Password: postgres (dev only)
- Database: greenthumb
- Extension: pgvector (vector, vector(768))

## API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - Register
- `POST /api/v1/auth/login` - Login

### Plants (structured plant knowledge)
- `GET /api/v1/plants` - List plants (supports `?search=`, `?category=`, `?limit=`, `?offset=`)
- `GET /api/v1/plants/:plantId` - Get a specific plant
- `POST /api/v1/plants` - Create a plant entry
- `DELETE /api/v1/plants/:plantId` - Delete a plant entry

### Books (RAG ingestion)
- `GET /api/v1/books` - List books
- `POST /api/v1/books/upload` - Upload + ingest book (async, SSE job tracking)
- `GET /api/v1/books/jobs/:jobId` - SSE stream for ingest progress
- `DELETE /api/v1/books/:bookId` - Delete book + chunks

### Search (semantic RAG)
- `GET /api/v1/search?q=...` - Semantic search across book chunks
- `GET /api/v1/search/ask?q=...&stream=false` - RAG AI answering
- `GET /api/v1/search/plants?q=...` - Plant-specific search
- `GET /api/v1/search/pests?q=...` - Pest/disease search
- `GET /api/v1/search/tips?q=...` - Tips and tasks search

### Health
- `GET /api/v1/health` - Health check

## Plant Entry Schema

Each plant entry contains the following fields:

### Identity
| Field           | Type   | Description                                |
|-----------------|--------|--------------------------------------------|
| id              | text   | UUID (auto-generated)                     |
| commonName      | text   | **Required.** e.g. "Roma Tomato"           |
| scientificName  | text   | e.g. "Solanum lycopersicum"                |
| variety         | text   | e.g. "Roma"                               |
| family          | text   | e.g. "Solanaceae"                         |
| category        | text   | vegetable, fruit, herb, flower, tree, nut, legume |

### Growing Conditions
| Field           | Type   | Description                                |
|-----------------|--------|--------------------------------------------|
| sunlight        | text   | full sun, partial shade, shade             |
| waterNeeds      | text   | low, moderate, high, consistent            |
| soilType        | text   | sandy, loamy, clay, chalky, well-draining  |
| soilPh          | text   | e.g. "6.0-7.0"                            |

### Hardiness
| Field           | Type   | Description                                |
|-----------------|--------|--------------------------------------------|
| zoneMin         | int    | Minimum USDA hardiness zone                |
| zoneMax         | int    | Maximum USDA hardiness zone                |
| frostTolerance  | text   | none, light, moderate, hardy                |

### Planting Details
| Field              | Type   | Description                          |
|--------------------|--------|--------------------------------------|
| plantingDepth      | text   | e.g. "1/4 inch", "2-3 feet deep"     |
| spacing            | text   | e.g. "18-24 inches"                  |
| daysToGermination  | int    | Typical days from seed to sprout     |
| daysToMaturity    | int    | Days from transplant/seed to harvest |

### Structure
| Field           | Type   | Description                              |
|-----------------|--------|------------------------------------------|
| matureHeight    | text   | e.g. "6-8 feet"                         |
| matureSpread    | text   | e.g. "3-4 feet"                         |
| growthHabit     | text   | bush, vine, trailing, upright, rosette   |
| perennialYears  | int    | null = annual, otherwise perennial       |

### Companions & Pests
| Field              | Type   | Description                  |
|--------------------|--------|------------------------------|
| companionPlants    | jsonb  | string[] of friendly plants  |
| incompatiblePlants | jsonb  | string[] of antagonist plants|
| commonPests        | jsonb  | string[] of pest names       |
| commonDiseases      | jsonb  | string[] of disease names   |

### Harvest
| Field              | Type   | Description                              |
|--------------------|--------|------------------------------------------|
| harvestWindow      | text   | e.g. "June-October"                     |
| harvestIndicators  | text   | e.g. "firm skin, full color"            |

### Notes
| Field       | Type   | Description                    |
|-------------|--------|--------------------------------|
| description | text   | General description            |
| careNotes   | text   | Additional care instructions   |

## Ingestion Pipeline (Books)

1. File uploaded → saved to `uploads/{uuid}.{ext}`
2. Text extracted (PDF/EPUB/TXT)
3. Text split into chunks (~400 tokens, 50 token overlap)
4. Each chunk embedded via `nomic-embed-text` at Ollama
5. Vectors stored in `chunk_embeddings` table (pgvector)
6. Progress streamed via SSE at `GET /books/jobs/:jobId`

## Docker Compose

See `docker/docker-compose.yml`
