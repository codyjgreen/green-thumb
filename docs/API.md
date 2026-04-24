# Green-Thumb API Documentation

**Base URL:** `http://localhost:4041` (local) · `https://api.dnd-dad.com` (production)
**Auth:** Bearer token (JWT) or API key via `X-API-Key` header
**OpenAPI Spec:** `GET /docs/json`

---

## Architecture Overview

Green-Thumb is a gardening knowledge RAG API backed by two data layers:

### Layer 1 — Structured Plant Database (instant, no LLM)
**9,359 plant entries** with rich structured data. Every field is queryable and pre-computed — no inference needed.

| Field | Coverage | Source |
|-------|----------|--------|
| Hardiness zones (min/max) | 6,610 (70.7%) | PFAF + Permapeople |
| Sunlight | 9,169 (98.0%) | PFAF |
| Water needs | 9,093 (97.2%) | PFAF |
| Soil type | 9,127 (97.5%) | PFAF |
| Mature height | 8,469 (90.5%) | PFAF |
| Growth habit | 9,028 (96.5%) | PFAF |
| Family | 9,183 (98.1%) | PFAF |
| Description | 8,799 (94.1%) | PFAF |
| Care notes (hazards, cultivation) | 9,355 (99.9%) | PFAF |
| PFAF photo | 6,262 (66.9%) | PFAF |
| Companion plants | 259 plants | University extension sources |

**Data sources:**
- **Permapeople** (`permapeople.org/api`) — initial import of ~9,000 plants with growing conditions
- **PFAF (Plants For A Future)** — 8,504-plant SQLite database used to enrich zones, sun, water, soil, height, family, photos, and hazard notes
- **University extension sources** — authoritative companion/antagonist data for 259 common garden plants
- **Wikipedia** — supplemental companion planting data

### Layer 2 — RAG Knowledge Base (semantic search, uses Ollama)
Ingested books/articles split into **chunks**, embedded via `nomic-embed-text`, stored in a vector database (pgvector). Searchable semantically — useful for questions beyond structured data.

**Current library:** 22 books covering vegetables, fruits, herbs, pests, diseases, composting, and garden planning.

---

## Endpoints

### Search

#### `GET /api/v1/search/companions`
**Instant companion plant lookup** — try this first, no LLM involved.

Returns pre-stored companion and incompatible plant data from the structured DB. Falls back to RAG if no DB data exists.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Plant name to look up (e.g. `"roma tomato"`, `"basil"`) |

**Response:**
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
    "soilType": "sandy, loamy, clay",
    "hardinessZone": "10-12",
    "matureHeight": "2m / 6.6ft",
    "growthHabit": "annual",
    "family": "Solanaceae",
    "careNotes": "⚠️ Hazards: toxic to dogs and cats\n\n📋 Cultivation: Prefers..."
  }
}
```

**Fallback behavior:**
1. Exact match on `commonName` or `scientificName`
2. Partial match (query appears anywhere in name)
3. First-word partial match
4. RAG search with web research enabled (slow, ~12s)

**Companion data coverage:** 259 plants have structured companion arrays from authoritative university sources. Remaining plants fall through to RAG.

---

#### `GET /api/v1/search/plants`
**Plant entry search** — find plants by name or attribute filters.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query |
| `category` | string | Filter by category (e.g. `vegetable`, `herb`, `fruit`) |
| `zone` | string | Filter by hardiness zone (e.g. `7`) |

**Example:** `GET /api/v1/search/plants?q=tomato&category=vegetable`

---

#### `GET /api/v1/search`
**Semantic RAG search** — embed a query and find relevant book chunks.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Natural language query |
| `type` | string | Filter by content type: `plant`, `pest`, `disease`, `composting`, `tip`, `task`, `general` |
| `limit` | number | Max results (default 5, max 20) |
| `bookId` | string | Limit search to a specific book |

**Response:**
```json
{
  "items": [
    {
      "id": "chunk-uuid",
      "bookId": "book-uuid",
      "contentText": "Tomatoes need full sun and consistent watering...",
      "type": "plant",
      "relevance": 0.87,
      "book": { "title": "The Vegetable Gardener's Guide" }
    }
  ],
  "query": "tomato care",
  "totalResults": 3
}
```

---

#### `GET /api/v1/search/ask`
**RAG-powered question answering** — ask any gardening question.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Question |
| `stream` | boolean | Enable SSE streaming (default `true`) |
| `limit` | number | Sources to include (default 5) |
| `web` | boolean | Enable web research fallback (default `true`) |
| `type` | string | Limit to content type |

**Streaming response (SSE):**
```
event: token
data: {"token": "Tomatoes"}

event: token
data: {"token": " need"}

event: sources
data: {"sources": [...]}
```

**Non-streaming response:** `GET /api/v1/search/ask?q=...&stream=false`
```json
{
  "answer": "Tomatoes need full sun (at least 6-8 hours daily)...",
  "sources": [
    {
      "chunkId": "abc123",
      "bookTitle": "The Vegetable Gardener's Guide",
      "chapter": "Chapter 4: Nightshades",
      "contentText": "Tomatoes need full sun...",
      "relevance": 0.91
    }
  ]
}
```

---

#### `GET /api/v1/search/enrich`
**Plant data enrichment** — look up growing conditions for a plant by name.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `plant` | string | Plant name |

Checks DB first (instant), falls back to web research via Brave Search.

**Response:**
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
  "source": "db",
  "sourceUrl": null
}
```

---

#### `GET /api/v1/search/pests`
**Pest identification** — search for pest information.

**Query params:** `q` (required), `limit`

---

#### `GET /api/v1/search/recommend`
**Gardening recommendations** — combines RAG with structured plant data.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Query (e.g. `"what to plant in zone 7"`) |
| `intent` | string | `companion`, `rotation`, `pest`, `soil`, `general` |

---

### Plants

#### `GET /api/v1/plants`
List all plant entries. Supports pagination with `take` / `skip`.

#### `GET /api/v1/plants/:plantId`
Get a single plant entry by ID.

#### `GET /api/v1/plants/:plantId/versions`
Get version history for a plant entry.

#### `POST /api/v1/plants`
Create a new plant entry.

#### `PUT /api/v1/plants/:plantId`
Update a plant entry.

#### `DELETE /api/v1/plants/:plantId`
Soft-delete a plant entry.

#### `GET /api/v1/plants/export`
Export all plants as JSON or CSV.

#### `POST /api/v1/plants/import`
Import plants from JSON/CSV file.

---

### Data Management

#### `GET /api/v1/data/sources`
List available data sources and their status.

```json
{
  "sources": [
    { "name": "permapeople", "status": "connected", "plantCount": 9359 },
    { "name": "brave-search", "status": "configured", "monthlyLimit": 2000 }
  ]
}
```

---

#### `POST /api/v1/data/plants/from-url`
Import plant data from an external URL (scrapes the page for structured plant info).

**Body:**
```json
{ "url": "https://..." }
```

---

#### `POST /api/v1/data/plants/upsert`
**Insert or update a single plant entry** (upsert by scientificName or commonName).

**Body:**
```json
{
  "commonName": "Roma Tomato",
  "scientificName": "Solanum lycopersicum var. roma",
  "family": "Solanaceae",
  "category": "vegetable",
  "sunlight": "full sun",
  "waterNeeds": "moderate",
  "soilType": "sandy, loamy, clay",
  "zoneMin": 10,
  "zoneMax": 12,
  "companionPlants": ["Basil", "Carrot", "Parsley"],
  "incompatiblePlants": ["Fennel", "Cabbage"]
}
```

**Response:**
```json
{
  "plant": { "id": "...", "commonName": "Roma Tomato" },
  "action": "created"
}
```

---

#### `POST /api/v1/data/plants/import-from-permapeople`
Trigger a full import from the Permapeople API. Requires `PERMAPEOPLE_KEY_ID` and `PERMAPEOPLE_KEY_SECRET` configured.

---

### Books (RAG Library)

#### `GET /api/v1/books`
List all ingested books.

#### `GET /api/v1/books/:bookId`
Get details for a specific book, including its chunk count.

#### `GET /api/v1/books/jobs/:jobId`
Check the status of a background ingestion job.

#### `POST /api/v1/books/upload`
Upload a PDF, EPUB, or TXT file to ingest into the RAG library.

**Body:** `multipart/form-data` with `file` field.

#### `POST /api/v1/books/url`
Ingest a book from a URL (PDF/EPUB).

**Body:** `{ "url": "https://..." }`

---

### Authentication

#### `POST /api/v1/auth/signup`
Create a new user account.

```json
{ "email": "you@example.com", "password": "yourpassword" }
```

#### `POST /api/v1/auth/login`
Login and receive JWT tokens.

```json
{ "email": "you@example.com", "password": "yourpassword" }
```

**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": "7d"
}
```

---

### API Keys

#### `GET /api/v1/api-keys`
List your API keys.

#### `POST /api/v1/api-keys`
Create a new API key.

**Body:**
```json
{ "name": "My App", "expiresIn": "30d" }
```

#### `DELETE /api/v1/api-keys/:id`
Revoke an API key.

---

### Webhooks

#### `GET /api/v1/webhooks`
List configured webhooks.

#### `POST /api/v1/webhooks`
Create a webhook.

**Body:**
```json
{
  "url": "https://yourapp.com/webhook",
  "events": ["search.query", "enrich.complete"],
  "secret": "your-secret"
}
```

#### `POST /api/v1/webhooks/:webhookId/test`
Send a test event to a webhook.

---

### Utility

#### `GET /api/v1/health`
Health check endpoint.

#### `GET /api/v1/metrics`
Prometheus-format metrics (request counts, latency percentiles, cache hit rates).

#### `GET /api/v1/ws`
WebSocket endpoint for real-time streaming responses.

---

## Field Reference — Plant Entries

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `commonName` | string | Common name | `"Roma Tomato"` |
| `scientificName` | string | Latin binomial | `"Solanum lycopersicum var. roma"` |
| `family` | string | Plant family | `"Solanaceae"` |
| `category` | string | Category | `"vegetable"`, `"herb"`, `"fruit"` |
| `sunlight` | string | Sun requirement | `"full sun"`, `"partial shade"`, `"full shade"` |
| `waterNeeds` | string | Water requirement | `"low"`, `"moderate"`, `"high"` |
| `soilType` | string | Preferred soil | `"sandy, loamy, clay"` |
| `soilPh` | string | pH range | `"6.0-7.0"` |
| `zoneMin` | int | Coldest hardiness zone | `10` |
| `zoneMax` | int | Warmest hardiness zone | `12` |
| `frostTolerance` | string | Frost tolerance | `"light"`, `"moderate"`, `"heavy"` |
| `plantingDepth` | string | Seed planting depth | `"1/4 inch"` |
| `spacing` | string | Plant spacing | `"24 inches"` |
| `daysToGermination` | int | Days to sprout | `7` |
| `daysToMaturity` | int | Days to harvest | `75` |
| `matureHeight` | string | Height range | `"2m / 6.6ft"` |
| `matureSpread` | string | Width/spray | `"24 inches"` |
| `growthHabit` | string | Growth form | `"annual"`, `"perennial"`, `"shrub"`, `"tree"` |
| `companionPlants` | string[] | Good neighbors | `["Basil", "Carrot"]` |
| `incompatiblePlants` | string[] | Bad neighbors | `["Fennel", "Cabbage"]` |
| `commonPests` | string[] | Known pest issues | `["aphids", "hornworm"]` |
| `commonDiseases` | string[] | Known disease issues | `["blight", "fusarium wilt"]` |
| `harvestWindow` | string | Harvest season | `"June-October"` |
| `harvestIndicators` | string | When to harvest | `"Fruit turns red and slips easily"` |
| `careNotes` | string | Growing notes/hazards | `"⚠️ Toxic to pets"` |
| `pfafImageUrl` | string | Photo from PFAF | `"https://pfaf.org/..."` |
| `pfafUrl` | string | PFAF plant page | `"https://pfaf.org/..."` |
| `description` | string | Summary description | `"Aroma tomato bred for..."` |
| `perennialYears` | int | Years to maturity | `2` |

---

## Growing Conditions by Category

### Sunlight Values
- `full sun` — 6+ hours direct sunlight
- `partial shade` — 3-6 hours, or protection from midday sun
- `full shade` — less than 3 hours direct sunlight

### Water Needs
- `low` — drought-tolerant, infrequent watering once established
- `moderate` — regular watering, soil should dry between waterings
- `high` — consistent moisture, never let soil dry out completely

### Growth Habits
- `annual` — completes life cycle in one season
- `perennial` — lives more than two years
- `biennial` — completes cycle in two years
- `shrub` — multi-stemmed woody plant
- `tree` — single-trunk woody plant
- `vining` — climbing or trailing habit
- `bulb` — grows from bulb/corm/rhizome
- `herbaceous` — non-woody, dies back seasonally

### Soil Type Mapping (PFAF codes → human-readable)
| Code | Soil Type |
|------|-----------|
| L | Sandy (light, fast-draining) |
| M | Loamy (medium, balanced) |
| H | Clay (heavy, moisture-retaining) |
| LM | Sandy loam |
| MH | Clay loam |
| LH | Sandy clay |
| LMH | All three combined |

---

## Common Queries

### Find all companion plants for tomatoes
```bash
curl "http://localhost:4041/api/v1/search/companions?q=tomato" \
  -H "X-API-Key: your-api-key"
```

### Find all plants in my hardiness zone
```bash
curl "http://localhost:4041/api/v1/search/plants?zone=7&category=vegetable" \
  -H "Authorization: Bearer your-jwt-token"
```

### Ask about a specific gardening problem
```bash
curl "http://localhost:4041/api/v1/search/ask?q=Why+are+my+tomato+leaves+turning+yellow" \
  -H "X-API-Key: your-api-key"
```

### Enrich a plant with full growing data
```bash
curl "http://localhost:4041/api/v1/search/enrich?plant=Roma+Tomato" \
  -H "X-API-Key: your-api-key"
```

### Sync a user's plant to the knowledge base
```bash
curl -X POST "http://localhost:4041/api/v1/data/plants/upsert" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "commonName": "My Garden Tomato",
    "scientificName": "Solanum lycopersicum var. roma",
    "variety": "Roma",
    "zoneMin": 10,
    "zoneMax": 12,
    "companionPlants": ["Basil", "Carrot"],
    "incompatiblePlants": ["Fennel"]
  }'
```

---

## Rate Limits & Performance

| Endpoint | Response time | Notes |
|----------|---------------|-------|
| `/search/companions` | **<50ms** | Pre-computed DB, no LLM |
| `/search/plants` | **<100ms** | DB index |
| `/search/enrich` | **<200ms** | DB or Brave Search |
| `/search` | **200-500ms** | Vector search |
| `/search/ask` | **2-15s** | LLM + optional web research |
| `/search/ask` (streaming) | **~1s first token** | SSE streaming |

**Cache TTL:** RAG query results cached for 2 hours.

---

## Error Codes

| Code | Meaning |
|------|---------|
| `401` | Missing or invalid API key / token |
| `403` | Forbidden — insufficient permissions |
| `404` | Plant not found in database |
| `422` | Validation error — missing or invalid fields |
| `429` | Rate limit exceeded |
| `502` | Green-Thumb downstream error |
| `503` | Green-Thumb not configured (missing API key) |