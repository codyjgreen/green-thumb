# Green-Thumb 🌱

**Gardening knowledge RAG API** — ingest PDF/EPUB/TXT books, extract and embed plant information, then query your gardening knowledge base from any app via a clean REST API.

> Think of it as a personal gardening wiki you train from your own book collection.

## API Base URLs

| Environment | URL |
|---|---|
| Local dev | `http://localhost:4041` |
| LAN access | `http://192.168.0.102:4041` |
| Swagger UI | `http://192.168.0.102:4041/docs` |
| OpenAPI spec | `http://192.168.0.102:4041/docs/json` |

## Quick Start

```bash
npm install
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d postgres  # optional — if no existing DB
npm run db:push
npm run dev
```

## What Data Is Available

The API manages two kinds of knowledge:

### 1. Book Knowledge (RAG — vector search)
Books and articles ingested as PDF, EPUB, or TXT are split into **chunks**, classified by content type, and embedded into a vector store. These are searchable semantically.

**Current library:** 22 ingested books/articles covering vegetables, fruits, herbs, pests, diseases, composting, and garden planning — see `/api/v1/books` for the full list.

**Content types** assigned to each chunk:
| Type | Description |
|------|-------------|
| `plant` | Planting, spacing, variety, harvest info |
| `pest` | Insects, bugs, aphids, beetles |
| `disease` | Blight, mold, rot, fungus |
| `composting` | Composting, organic matter, soil health |
| `tip` | General tips, notes, warnings |
| `task` | Actionable tasks (prune, water, spray) |
| `general` | Unclassified content |

### 2. Structured Plant DB — 9,359 Plants
**9,359 plant entries** with rich, pre-computed growing data.

Two data sources are merged into every plant entry:

**Permapeople** (`permapeople.org/api`) — initial import of ~9,000 plants with common/scientific names and basic growing info.

**PFAF (Plants For A Future)** — 8,504-plant database used to enrich entries with hardiness zones, sunlight, water needs, soil type, mature height, growth habit, plant family, descriptions, hazard warnings, and photos.

**Companion Planting:** 259 common garden plants have **authoritative companion/antagonist arrays** from university extension sources. Try `/api/v1/search/companions` — this endpoint is under 50ms with no LLM involved.

Each plant entry includes:
- `commonName`, `scientificName`, `family`, `category`
- `sunlight`, `waterNeeds`, `soilType`, `soilPh`
- `zoneMin`, `zoneMax`, `frostTolerance`
- `plantingDepth`, `spacing`, `daysToGermination`, `daysToMaturity`
- `matureHeight`, `matureSpread`, `growthHabit`
- `companionPlants[]`, `incompatiblePlants[]`
- `commonPests[]`, `commonDiseases[]`
- `harvestWindow`, `harvestIndicators`, `careNotes`

The plant DB is also embedded into the RAG system — plant info appears in semantic search results.

---

## Authentication

Two options are available: **JWT tokens** (for web apps with user login) and **API keys** (for programmatic/server-to-server access).

### Option 1 — JWT Bearer Token (web apps)

```bash
# 1. Create an account
curl -X POST http://localhost:4041/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# 2. Login to get a token
curl -X POST http://localhost:4041/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
# Returns: { "accessToken": "eyJ...", "expiresIn": "7d" }

# 3. Use the token on all authenticated requests
curl http://localhost:4041/api/v1/books \
  -H "Authorization: Bearer eyJ..."
```

### Option 2 — API Key (recommended for other apps)

API keys are ideal for external apps that only need to read data or make automated updates without user login. The key is passed via the `X-API-Key` header.

**Permission levels:**
| Permission | GET | POST/PATCH | DELETE |
|---|---|---|---|
| `read` | ✅ | ❌ 403 | ❌ 403 |
| `readwrite` | ✅ | ✅ | ✅ |

```bash
# 1. Create an API key (requires JWT login first)
curl -X POST http://localhost:4041/api/v1/api-keys \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"name": "My Garden App v1", "permissions": "read"}'

# Returns the key ONCE — save it immediately:
# {
#   "id": "cmox...",
#   "name": "My Garden App v1",
#   "keyPrefix": "gt_abc123xy",
#   "permissions": "read",
#   "fullKey": "gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P",  ← save this!
#   "message": "Save this key now — it will not be shown again."
# }

# 2. Use the key on any request
curl http://localhost:4041/api/v1/plants \
  -H "X-API-Key: gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P"

# Read-only key attempting DELETE → 403
curl -X DELETE http://localhost:4041/api/v1/plants/cmox... \
  -H "X-API-Key: gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P"
# → { "statusCode": 403, "message": "This API key has 'read' permissions only." }
```

**Managing keys:**
```bash
# List all your API keys (key value is never returned — only prefix)
curl http://localhost:4041/api/v1/api-keys \
  -H "Authorization: Bearer eyJ..."
# → { "items": [{ "id": "...", "name": "...", "keyPrefix": "gt_abc123xy", "permissions": "read" }] }

# Revoke a key
curl -X DELETE http://localhost:4041/api/v1/api-keys/cmox... \
  -H "Authorization: Bearer eyJ..."
# → { "deleted": true, "id": "cmox..." }
```

> **Note:** External consumer apps should use `read` permission and only GET endpoints. Store your own garden data in your app's database — use Green-Thumb's GET endpoints to browse and query the shared knowledge base.

---

## API Reference

Interactive documentation at **`/docs`** — try endpoints directly from the browser.

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/health` | No | Health + database status |

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/auth/signup` | No | Create account |
| `POST` | `/api/v1/auth/login` | No | Get JWT token |

### Books (RAG knowledge)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/books` | Yes | List all ingested books with chunk counts |
| `GET` | `/api/v1/books/:bookId` | Yes | Get a specific book |
| `POST` | `/api/v1/books/upload` | Yes | Upload PDF/EPUB/TXT, ingest in background |
| `POST` | `/api/v1/books/url` | Yes | Fetch & ingest a web article from URL |
| `DELETE` | `/api/v1/books/:bookId` | Yes | Delete book and all its chunks |
| `GET` | `/api/v1/books/jobs/:jobId` | Yes | SSE stream for ingest progress |

### Search (semantic + RAG + structured DB)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/search/companions?q=...` | Yes | **Instant** companion/antagonist lookup (no LLM, <50ms) |
| `GET` | `/api/v1/search/plants?q=...` | Yes | Search plant entries by name or filter |
| `GET` | `/api/v1/search/enrich?plant=...` | Yes | Enrich a plant with full growing conditions |
| `GET` | `/api/v1/search?q=...` | Yes | Semantic search across book chunks |
| `GET` | `/api/v1/search/pests?q=...` | Yes | Semantic search for pest/disease info |
| `GET` | `/api/v1/search/tips?q=...` | Yes | Semantic search for tips and tasks |
| `GET` | `/api/v1/search/ask?q=...` | Yes | RAG AI answer synthesis from your library |
| `GET` | `/api/v1/search/recommend?q=...` | Yes | Gardening recommendations |

### Plants (structured DB)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/plants` | Yes | List plants (search, filter by category, paginate) |
| `GET` | `/api/v1/plants/:plantId` | Yes | Get a specific plant |
| `POST` | `/api/v1/plants` | Yes | Create/update a plant entry |
| `PATCH` | `/api/v1/plants/:plantId` | Yes | Update a plant entry |
| `DELETE` | `/api/v1/plants/:plantId` | Yes | Delete a plant entry |
| `GET` | `/api/v1/plants/export` | Yes | Export all plants as JSON or CSV |
| `POST` | `/api/v1/plants/import` | Yes | Bulk import plants from JSON/CSV |
| `GET` | `/api/v1/plants/:plantId/versions` | Yes | Version history for a plant |
| `POST` | `/api/v1/plants/:plantId/versions/:v/restore` | Yes | Restore a previous version |

### Tasks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/tasks` | Yes | List all actionable tasks from books |
| `GET` | `/api/v1/tasks/:taskId` | Yes | Get a specific task |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/webhooks` | Yes | List registered webhooks |
| `POST` | `/api/v1/webhooks` | Yes | Register a webhook |
| `DELETE` | `/api/v1/webhooks/:webhookId` | Yes | Delete a webhook |
| `POST` | `/api/v1/webhooks/:webhookId/test` | Yes | Fire a test event |

---

## Usage Examples

### Companion Plant Lookup (fast, no LLM)
```bash
curl "http://localhost:4041/api/v1/search/companions?q=roma+tomato" \
  -H "X-API-Key: gt_MXZnEr96l3SgOEtlBCu50XccplVNNQaB"
```
```json
{
  "source": "green-thumb-db",
  "plant": "Roma Tomato",
  "scientificName": "Solanum lycopersicum var. roma",
  "companionPlants": ["Basil", "Carrot", "Parsley", "Marigold", "Asparagus", "Celery", "Onion", "Pepper"],
  "incompatiblePlants": ["Fennel", "Kohlrabi", "Cabbage", "Corn", "Dill"],
  "growingInfo": {
    "sunlight": "full sun",
    "waterNeeds": "moderate",
    "hardinessZone": "10-12",
    "matureHeight": "2m / 6.6ft",
    "family": "Solanaceae"
  }
}
```

### Search book chunks (semantic)
```bash
curl "http://localhost:4041/api/v1/search?q=tomato+blight&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```
```json
{
  "query": "tomato blight",
  "items": [
    {
      "chunkId": "cmox...",
      "contentText": "Late blight thrives in cool, wet conditions...",
      "contentType": "disease",
      "chapter": "Tomato Diseases",
      "relevance": 0.847,
      "book": { "id": "...", "title": "Maritime Northwest Garden Guide" }
    }
  ],
  "total": 5
}
```

### RAG Ask (AI synthesis)
```bash
curl "http://localhost:4041/api/v1/search/ask?q=how+to+grow+tomatoes&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```
Returns an AI-synthesized answer citing the relevant book chunks.

### Enrich a plant with growing conditions
```bash
curl "http://localhost:4041/api/v1/search/enrich?plant=Roma+Tomato" \
  -H "X-API-Key: gt_MXZnEr96l3SgOEtlBCu50XccplVNNQaB"
```
```json
{
  "plant": {
    "commonName": "Roma Tomato",
    "scientificName": "Solanum lycopersicum var. roma",
    "sunlight": "full sun",
    "waterNeeds": "moderate",
    "zoneMin": 10,
    "zoneMax": 12,
    "matureHeight": "2m / 6.6ft",
    "family": "Solanaceae"
  },
  "source": "db"
}
```

### Browse plants
```bash
# All plants, paginated
curl "http://localhost:4041/api/v1/plants?limit=5&offset=0" \
  -H "Authorization: Bearer $TOKEN"

# Search by name
curl "http://localhost:4041/api/v1/plants?search=basil&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Filter by category
curl "http://localhost:4041/api/v1/plants?category=herb&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### Ingest a book
```bash
# File upload (returns jobId, track progress via SSE)
curl -X POST http://localhost:4041/api/v1/books/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@my-garden-book.pdf"

# From URL (web article)
curl -X POST http://localhost:4041/api/v1/books/url \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/gardening-article"}'
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3002` | Port the API listens on |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | required | Secret for signing JWTs |
| `JWT_REFRESH_SECRET` | required | Secret for refresh tokens |
| `UPLOADS_DIR` | `./uploads` | Where uploaded files are stored |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Model for generating embeddings |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | Model for chat synthesis |
| `OLLAMA_MAX_CONCURRENT` | `2` | Max concurrent Ollama requests |
| `SEARCH_CACHE_TTL_SECONDS` | `3600` | Search result cache TTL |
| `EMBEDDING_CACHE_TTL_SECONDS` | `604800` | Embedding cache TTL (7 days) |

---

## Architecture

```
Book (PDF/EPUB/TXT)
  └─► Extract text by chapter/section
        └─► Classify content type (plant, pest, composting, tip, task, general)
              └─► Split into chunks (~400 tokens, paragraph-aware)
                    └─► Embed each chunk with Ollama (nomic-embed-text)
                          └─► Store in PostgreSQL + pgvector

Plant DB (structured)
  └─► Auto-ingested into RAG as synthetic book
        └─► Each plant → text chunk → embedded

Query
  └─► Embed query with Ollama
        └─► pgvector cosine similarity search
              └─► Return ranked chunks + source book
                    └─► (Optional) Synthesize answer with Ollama chat
```

## Database Schema

```
books            uploaded book/article metadata
book_chunks      extracted text sections with content type tags
chunk_embeddings vector embeddings (pgvector Float[1536])
plant_entries   structured plant info (common name, family, etc.)
plant_versions   version history for plant edits
users           auth accounts
webhooks         registered webhook subscriptions
```

---

## Connecting from Other Apps

The API is intentionally plain REST — no SDK required, works with any language or platform. For external apps, use an API key (not JWT) to avoid session management.

```typescript
// TypeScript / JavaScript — using API key
const API_KEY = 'gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P';
const API_BASE = 'https://greenthumb.dnd-dad.com'; // or http://192.168.0.102:4041

const res = await fetch(`${API_BASE}/api/v1/plants?category=vegetable&limit=20`, {
  headers: { 'X-API-Key': API_KEY },
});
const { items, total } = await res.json();
console.log(`Found ${total} vegetables`);

// Companion plant lookup (fast, no LLM)
const companionRes = await fetch(`${API_BASE}/api/v1/search/companions?q=roma+tomato`, {
  headers: { 'X-API-Key': API_KEY },
});
const { companionPlants, incompatiblePlants } = await companionRes.json();
console.log('Good neighbors:', companionPlants);
console.log('Bad neighbors:', incompatiblePlants);

// Search and get AI recommendations
const ragRes = await fetch(`${API_BASE}/api/v1/search/recommend?q=companion+plants+for+tomatoes`, {
  headers: { 'X-API-Key': API_KEY },
});
const recs = await ragRes.json();
console.log(recs.intent, recs.summary);

// Python
import requests
API_KEY = 'gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P'
resp = requests.get(
    "https://greenthumb.dnd-dad.com/api/v1/search/companions",
    params={"q": "roma tomato"},
    headers={"X-API-Key": API_KEY}
)
data = resp.json()
print("Good neighbors:", data["companionPlants"])
print("Bad neighbors:", data["incompatiblePlants"])
```

---

## Docker

```bash
# Full stack (API + PostgreSQL)
docker compose -f infra/docker/docker-compose.yml up -d

# Just the API (use existing PostgreSQL)
docker build -f infra/docker/Dockerfile -t green-thumb-api .
docker run -p 4041:3000 green-thumb-api
```

---

## Development

```bash
npm run dev        # Start dev server with hot-reload
npm run db:push    # Push Prisma schema to DB
npm run db:studio  # Open Prisma Studio
npm run typecheck  # Type-check without emitting
npm test           # Run tests
```

---

## Tech Stack

- **Fastify** — Fast, low-overhead web framework
- **Prisma** — Type-safe database ORM
- **pgvector** — Vector similarity search in PostgreSQL
- **Ollama** — Local LLM inference (no external API calls)
- **pdfplumber** — PDF text extraction
- **epub2** / direct parse — EPUB extraction

---

## Hosting & Deployment

For permanent self-hosting on your home server (`192.168.0.102`):

📖 **Full guide:** [`deploy/HOSTING.md`](deploy/HOSTING.md)

### TL;DR — What to install

```bash
# 1. Copy systemd services
sudo cp deploy/green-thumb-api.service        /etc/systemd/system/
sudo cp deploy/green-thumb-frontend.service   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable green-thumb-api green-thumb-frontend
sudo systemctl start green-thumb-api green-thumb-frontend

# 2. Add nginx site config (see deploy/HOSTING.md for full config)
sudo ln -sf /etc/nginx/sites-available/greenthumb.conf /etc/nginx/sites-enabled/

# 3. Cloudflare DNS: A record for greenthumb.dnd-dad.com → your public IP (port 443)
```

### Service URLs (after setup)

| Service | LAN URL | Public URL |
|---------|---------|------------|
| Frontend | `http://192.168.0.102:4042` | `https://greenthumb.dnd-dad.com` |
| API | `http://192.168.0.102:4041/api/v1` | `https://greenthumb.dnd-dad.com/api/v1` |
| Swagger UI | `http://192.168.0.102:4041/docs` | `https://greenthumb.dnd-dad.com/docs` |
| OpenAPI JSON | `http://192.168.0.102:4041/docs/json` | `https://greenthumb.dnd-dad.com/docs/json` |

