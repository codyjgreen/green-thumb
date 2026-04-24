# Green-Thumb API Documentation

**Base URL:** `http://localhost:4041` (local) · `https://api.dnd-dad.com` (production)
**Auth:** Bearer token (JWT) or API key via `X-API-Key` header
**OpenAPI Spec:** `GET /docs/json`

---

## Getting Started

### Step 1 — Create an account
```bash
curl -X POST https://api.dnd-dad.com/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"cody@example.com","password":"mysecretpassword"}'
# → { "id": "...", "email": "cody@example.com" }
```

### Step 2 — Login to get a JWT token
```bash
curl -X POST https://api.dnd-dad.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"cody@example.com","password":"mysecretpassword"}'
# → { "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "expiresIn": "7d" }
```
Copy the `accessToken` value — you'll use it for the next step.

### Step 3 — Create an API key
```bash
curl -X POST https://api.dnd-dad.com/api/v1/api-keys \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"name":"My Garden App","permissions":"read"}'
# → {
#   "id": "cmox...",
#   "name": "My Garden App",
#   "keyPrefix": "gt_abc123xy",
#   "permissions": "read",
#   "fullKey": "gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P",
#   "message": "Save this key now — it will not be shown again."
# }
# ⚠️ COPY fullKey NOW — it will never be shown again!
```

**Permissions:**
| Value | GET | POST/PATCH | DELETE |
|-------|-----|------------|--------|
| `read` | ✅ | ❌ 403 | ❌ 403 |
| `readwrite` | ✅ | ✅ | ✅ |

### Step 4 — Use the API key

Once you have your API key, use it instead of JWT for all requests:

```bash
# Companion lookup (fast, no LLM)
curl "https://api.dnd-dad.com/api/v1/search/companions?q=tomato" \
  -H "X-API-Key: gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P"

# Browse plants
curl "https://api.dnd-dad.com/api/v1/plants?category=vegetable&limit=5" \
  -H "X-API-Key: gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P"
```

### Try it in Swagger UI
1. Open [https://api.dnd-dad.com/docs](https://api.dnd-dad.com/docs)
2. Click **Authorize** 🔒 at the top
3. Paste your API key (starts with `gt_`) into the `apiKeyAuth` field
4. Click **Authorize**, then close — every "Try it out" button now works for all endpoints

> **JWT is only needed for:** creating API keys, revoking API keys, and managing your account. Everything else works with an API key.

---

## What Data Is Available

The API manages two kinds of knowledge:

### Layer 1 — Structured Plant Database

**9,359 plant entries** with rich, pre-computed growing data. Every field is queryable — no inference needed.

| Field | Coverage | Source |
|-------|----------|--------|
| `sunlight` | 9,169 / 9,359 (98.0%) | PFAF |
| `waterNeeds` | 9,093 / 9,359 (97.2%) | PFAF |
| `soilType` | 9,127 / 9,359 (97.5%) | PFAF |
| `family` | 9,183 / 9,359 (98.1%) | PFAF |
| `description` | 8,799 / 9,359 (94.0%) | PFAF |
| `matureHeight` | 8,469 / 9,359 (90.5%) | PFAF |
| `growthHabit` | covers most plants | PFAF |
| `hardiness zones` | 6,611 / 9,359 (70.6%) | PFAF + Permapeople |
| `careNotes` / `knownHazards` | nearly all plants | PFAF |
| `pfafImageUrl` | 6,262 / 9,359 (66.9%) | PFAF |
| `companionPlants` | **259 plants** | University extension sources + Wikipedia |
| `incompatiblePlants` | **230 plants** | University extension sources + Wikipedia |

**Data sources:**
- **Permapeople** (`permapeople.org/api`) — initial import of ~9,000 plants with growing conditions (CC BY-SA 4.0)
- **PFAF (Plants For A Future)** — 8,504-plant database enriched with hardiness zones, sunlight, water needs, soil type, mature height, growth habit, plant family, descriptions, hazard warnings, and photos
- **University extension sources** — authoritative companion/antagonist data (e.g. Cornell, Michigan State, Oregon State)
- **Wikipedia** — supplemental companion planting table (CC BY-SA) for additional plant coverage

**Companion data notes:** 259 plants have pre-stored companion arrays. 230 have incompatible plant arrays. Remaining plants can still be queried — the API falls back to RAG search (~12s) when no pre-stored data exists.

**Plants with pre-stored companion data include:** Tomato, Roma Tomato, Cherry Tomato, Basil, Sweet Basil, Thai Basil, Lettuce, Romaine Lettuce, Butterhead Lettuce, Carrot, Parsley, Cilantro, Dill, Fennel, Cabbage, Broccoli, Cauliflower, Kale, Brussels Sprouts, Spinach, Pepper, Bell Pepper, Jalapeño Pepper, Chili Pepper, Onion, Garlic, Leek, Shallot, Potato, Sweet Potato, Corn, Bean, Bush Bean, Pole Bean, Lima Bean, Green Bean, Pea, Sugar Snap Pea, Snow Pea, Cucumber, Pickling Cucumber, Zucchini, Summer Squash, Butternut Squash, Acorn Squash, Pumpkin, Radish, Beet, Turnip, Parsnip, Celery, Asparagus, Artichoke, Eggplant, Okra, Pumpkin, Marigold, Nasturtium, Sunflower, Lavender, Rosemary, Sage, Thyme, Mint, Oregano, Chives, and many more.

**Plant categories in DB:** The 9,359 plant entries span a wide range. Largest groups: `shrub` (1,972), `tree` (940), `Tall trees` (939), `vine` (417), `vegetable` (394), `herb` (346), `flower` (124), `fruit` (28), `Roots` (27). Many entries have no category set (4,151 null). Filter by category using `?category=vegetable` on `/api/v1/plants`.

### Layer 2 — RAG Knowledge Base (semantic search, uses Ollama)

Ingested books/articles split into **chunks**, embedded via `nomic-embed-text`, stored in pgvector. Searchable semantically — useful for questions beyond structured data.

| Stat | Value |
|------|-------|
| Total books | 31 (21 quality titles + 10 web articles) |
| Total chunks | 3,775 |
| Content types | `plant` (1,470) · `pest` (1,038) · `general` (785) · `disease` (294) · `composting` (90) · `task` (69) · `tip` (29) |

**Quality book topics:** vegetables, fruits, herbs, pests, diseases, composting, raised beds, container gardening, greenhouses, PNW gardening, permaculture, orchards.

---

## Quick Reference — Available Endpoints

### Search (start here)
| Method | Path | Speed | Description |
|--------|------|-------|-------------|
| `GET` | `/api/v1/search/companions?q=...` | **<50ms** | Pre-stored companion/antagonist lookup |
| `GET` | `/api/v1/search/plants?q=...` | <100ms | Plant entry search by name/filter |
| `GET` | `/api/v1/search/enrich?plant=...` | <200ms | Enrich a plant with full growing data |
| `GET` | `/api/v1/search?q=...` | 200–500ms | Semantic search across book chunks |
| `GET` | `/api/v1/search/pests?q=...` | 200–500ms | Pest/disease semantic search |
| `GET` | `/api/v1/search/ask?q=...` | 2–15s | RAG AI answer synthesis (streaming) |
| `GET` | `/api/v1/search/recommend?q=...` | 2–15s | Gardening recommendations |

### Plants
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/plants` | List plants (paginate, filter by category/zone) |
| `GET` | `/api/v1/plants/:id` | Get a specific plant |
| `POST` | `/api/v1/plants` | Create a plant entry |
| `PATCH` | `/api/v1/plants/:id` | Update a plant entry |
| `DELETE` | `/api/v1/plants/:id` | Soft-delete a plant |
| `GET` | `/api/v1/plants/export` | Export all plants as JSON or CSV |
| `POST` | `/api/v1/plants/import` | Bulk import from JSON/CSV |
| `GET` | `/api/v1/plants/:id/versions` | Version history |
| `POST` | `/api/v1/plants/:id/versions/:v/restore` | Restore a previous version |

### Data Management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/data/sources` | List data sources and status |
| `POST` | `/api/v1/data/plants/upsert` | Insert or update a plant (by scientificName) |
| `POST` | `/api/v1/data/plants/import-from-permapeople` | Full Permapeople re-import |

### Books (RAG library)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/books` | List all ingested books with chunk counts |
| `GET` | `/api/v1/books/:id` | Get a specific book |
| `POST` | `/api/v1/books/upload` | Upload PDF/EPUB/TXT, ingest in background |
| `POST` | `/api/v1/books/url` | Fetch & ingest a web article |
| `DELETE` | `/api/v1/books/:id` | Delete book and all its chunks |
| `GET` | `/api/v1/books/jobs/:jobId` | SSE stream for ingest progress |

### Auth & API Keys
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/signup` | Create account |
| `POST` | `/api/v1/auth/login` | Get JWT token |
| `GET` | `/api/v1/api-keys` | List your API keys |
| `POST` | `/api/v1/api-keys` | Create a new API key |
| `DELETE` | `/api/v1/api-keys/:id` | Revoke an API key |

### Utility
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health + DB status |
| `GET` | `/api/v1/metrics` | Prometheus metrics |

---

## In-Depth Endpoint Docs

### `GET /api/v1/search/companions`

**Instant companion plant lookup** — the fastest endpoint, no LLM involved.

Returns pre-stored companion and incompatible plant data from the structured DB. Falls back to RAG if no DB data exists.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Plant name (e.g. `"roma tomato"`, `"basil"`) |

**Fallback chain:**
1. Exact match on `commonName` or `scientificName`
2. Partial match (query appears anywhere in name)
3. First-word partial match
4. RAG search with web research (~12s)

**Companion data coverage:** 259 plants have pre-stored companion arrays. 230 have incompatible plant arrays. Remaining ~9,100 plants fall through to RAG search with web fallback (~12s).

**Example response:**
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

---

### `GET /api/v1/search/plants`

Plant entry search by name or attribute filters.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query |
| `category` | string | Filter: `vegetable`, `herb`, `fruit`, `flower`, `tree`, `shrub`, `vine`, `legume`, `nut`, `ground cover`, `Roots` |
| `zone` | number | Filter by suitable hardiness zone |

**Example:** `GET /api/v1/search/plants?q=tomato&category=vegetable`

---

### `GET /api/v1/search`

Semantic RAG search across all book chunks.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Natural language query |
| `type` | string | Filter by content type: `plant`, `pest`, `disease`, `composting`, `tip`, `task`, `general` |
| `limit` | number | Max results (default 5, max 20) |
| `bookId` | string | Limit to a specific book |

---

### `GET /api/v1/search/ask`

RAG-powered question answering — asks any gardening question and synthesizes an answer from your book library.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | required | Question |
| `stream` | boolean | `true` | SSE streaming response |
| `limit` | number | 5 | Number of source chunks to cite |
| `web` | boolean | `true` | Enable Brave Search fallback if no book data found |
| `type` | string | — | Limit to a content type |

**Streaming response (SSE):**
```
event: token
data: {"token": "Tomatoes"}

event: token
data: {"token": " need"}

event: sources
data: {"sources": [...]}
```

**Non-streaming:** add `&stream=false`

---

### `GET /api/v1/search/enrich`

Look up full growing conditions for a plant by name. Checks DB first (instant), falls back to Brave Search web lookup.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `plant` | string | Plant name |

---

### `GET /api/v1/search/recommend`

Combines structured plant data with RAG synthesis for planning queries (e.g. crop rotation, what to plant in a zone, soil preparation).

---

## Plant Entry Fields

Every plant entry includes:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `commonName` | string | Common name | `"Roma Tomato"` |
| `scientificName` | string | Latin binomial, unique | `"Solanum lycopersicum var. roma"` |
| `variety` | string | Variety name | `"Roma"` |
| `family` | string | Plant family | `"Solanaceae"` |
| `category` | string | Category | `"vegetable"`, `"herb"`, `"fruit"`, `"flower"`, `"tree"`, `"shrub"`, `"vine"`, `"legume"`, `"nut"`, `"ground cover"`, `"Roots"` |
| `description` | string | Summary | `"Aroma tomato bred for..."` |
| `sunlight` | string | Sun requirement | `"full sun"`, `"partial shade"`, `"full shade"` |
| `waterNeeds` | string | Water requirement | `"low"`, `"moderate"`, `"high"`, `"consistent"` |
| `soilType` | string | Preferred soil | `"sandy, loamy, clay"` |
| `soilPh` | string | pH range | `"6.0-7.0"` |
| `zoneMin` | int | Coldest hardiness zone | `5` |
| `zoneMax` | int | Warmest hardiness zone | `10` |
| `frostTolerance` | string | Frost tolerance | `"none"`, `"light"`, `"moderate"`, `"hardy"` |
| `plantingDepth` | string | Seed planting depth | `"1/4 inch"`, `"2-3 feet deep"` |
| `spacing` | string | Plant spacing | `"18-24 inches"` |
| `daysToGermination` | int | Days to sprout | `7` |
| `daysToMaturity` | int | Days to harvest | `75` |
| `matureHeight` | string | Height range | `"2m / 6.6ft"` |
| `matureSpread` | string | Width/spread | `"24 inches"` |
| `growthHabit` | string | Growth form | `"annual"`, `"perennial"`, `"vine"`, `"bush"`, `"upright"`, `"rosette"` |
| `perennialYears` | int | Years to maturity (null = annual) | `3` |
| `companionPlants` | string[] | Good neighbors | `["Basil", "Carrot"]` |
| `incompatiblePlants` | string[] | Bad neighbors | `["Fennel", "Cabbage"]` |
| `commonPests` | string[] | Known pest issues | `["aphids", "hornworm"]` |
| `commonDiseases` | string[] | Known disease issues | `["blight", "fusarium wilt"]` |
| `harvestWindow` | string | Harvest season | `"June-October"` |
| `harvestIndicators` | string | When to harvest | `"Fruit turns red and slips easily"` |
| `careNotes` | string | Growing notes, hazards | `"⚠️ Toxic to pets"` |
| `knownHazards` | string | Toxicity, warnings | `"toxic to dogs and cats"` |
| `cultivationDetails` | string | Detailed cultivation from PFAF | |
| `range` | string | Geographic range | |
| `habitats` | string | Natural habitats | |
| `imageUrl` | string | Photo URL (Permapeople) | |
| `pfafImageUrl` | string | Photo URL (PFAF) | `"https://pfaf.org/..."` |
| `pfafUrl` | string | PFAF plant page | `"https://pfaf.org/..."` |
| `permapeopleUrl` | string | Permapeople page | `"https://permapeople.org/..."` |
| `synonyms` | string | Alternative names | |

---

## Growing Conditions Reference

### Sunlight
| Value | Meaning |
|-------|---------|
| `full sun` | 6+ hours direct sunlight |
| `partial shade` | 3–6 hours, or protection from midday sun |
| `full shade` | less than 3 hours direct sunlight |

### Water Needs
| Value | Meaning |
|-------|---------|
| `low` | drought-tolerant, infrequent watering once established |
| `moderate` | regular watering, soil should dry between waterings |
| `high` | consistent moisture, never let soil dry out completely |
| `consistent` | even moisture at all times |

### Soil Type (PFAF codes → human-readable)
| Code | Soil Type |
|------|-----------|
| L | Sandy (light, fast-draining) |
| M | Loamy (medium, balanced) |
| H | Clay (heavy, moisture-retaining) |
| LM | Sandy loam |
| MH | Clay loam |
| LH | Sandy clay |
| LMH | All three combined |

### Growth Habit Values
`annual` · `perennial` · `biennial` · `shrub` · `tree` · `vining` · `bulb` · `herbaceous` · `bush` · `upright` · `trailing` · `rosette`

### Frost Tolerance Values
`none` — killed by any frost
`light` — survives light frosts (32–28°F)
`moderate` — survives moderate frosts (28–20°F)
`hardy` — survives hard frosts (below 20°F)

---

## Authentication

### JWT Bearer Token — for web apps with user login

```bash
# 1. Create account
curl -X POST https://api.dnd-dad.com/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# 2. Login → get token
curl -X POST https://api.dnd-dad.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
# → { "accessToken": "eyJ...", "expiresIn": "7d" }

# 3. Use token on any request
curl https://api.dnd-dad.com/api/v1/plants \
  -H "Authorization: Bearer eyJ..."
```

### API Key — recommended for external apps and scripts

API keys are long-lived and don't expire. Create one after login, then use it instead of JWT for everything.

```bash
# 1. Create key (requires JWT from login)
curl -X POST https://api.dnd-dad.com/api/v1/api-keys \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"name": "My Garden App", "permissions": "read"}'
# → { "fullKey": "gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P", ... }
# ⚠️ Save this now — it is never shown again!

# 2. Use the key on any request (no JWT needed)
curl https://api.dnd-dad.com/api/v1/plants \
  -H "X-API-Key: gt_abc123xy1eTrXmwa1_rqxKvUhTMnd_P"
```

**Permission levels:**
| Permission | GET | POST/PATCH | DELETE |
|---|---|---|---|
| `read` | ✅ | ❌ 403 | ❌ 403 |
| `readwrite` | ✅ | ✅ | ✅ |

**Managing your API keys:**
```bash
# List all your keys (never shows the full key — only prefix + name)
curl https://api.dnd-dad.com/api/v1/api-keys \
  -H "Authorization: Bearer eyJ..."
# → { "items": [{ "id": "...", "name": "My Garden App", "keyPrefix": "gt_abc123xy", "permissions": "read" }] }

# Revoke a key (you need the key's UUID from the list response)
curl -X DELETE https://api.dnd-dad.com/api/v1/api-keys/cmox... \
  -H "Authorization: Bearer eyJ..."
# → { "deleted": true, "id": "cmox..." }
```

---

## Usage Examples

### Companion Plant Lookup (fastest, no LLM)
```bash
curl "http://localhost:4041/api/v1/search/companions?q=roma+tomato" \
  -H "X-API-Key: your-api-key"
```

### Search Plants
```bash
# By name
curl "http://localhost:4041/api/v1/search/plants?q=tomato&category=vegetable" \
  -H "Authorization: Bearer your-token"

# By hardiness zone
curl "http://localhost:4041/api/v1/search/plants?zone=7&category=fruit" \
  -H "X-API-Key: your-api-key"
```

### Browse All Plants (paginated)
```bash
curl "http://localhost:4041/api/v1/plants?take=20&skip=0" \
  -H "X-API-Key: your-api-key"
```

### Ask a Gardening Question (RAG)
```bash
curl "http://localhost:4041/api/v1/search/ask?q=how+to+prevent+tomato+blight" \
  -H "X-API-Key: your-api-key"
# Streaming SSE response with AI answer + source citations
```

### Semantic Search (book chunks)
```bash
curl "http://localhost:4041/api/v1/search?q=tomato+blight&limit=5&type=disease" \
  -H "Authorization: Bearer your-token"
```

### Enrich a Plant with Growing Data
```bash
curl "http://localhost:4041/api/v1/search/enrich?plant=Roma+Tomato" \
  -H "X-API-Key: your-api-key"
```

### Upsert a Plant (create or update)
```bash
curl -X POST "http://localhost:4041/api/v1/data/plants/upsert" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "commonName": "My Garden Tomato",
    "scientificName": "Solanum lycopersicum var. roma",
    "zoneMin": 10,
    "zoneMax": 12,
    "companionPlants": ["Basil", "Carrot"],
    "incompatiblePlants": ["Fennel"]
  }'
```

### Export / Import Plants
```bash
# Export all as JSON
curl "http://localhost:4041/api/v1/plants/export?format=json" \
  -H "X-API-Key: your-api-key" > plants.json

# Export as CSV
curl "http://localhost:4041/api/v1/plants/export?format=csv" \
  -H "X-API-Key: your-api-key" > plants.csv

# Import from JSON/CSV
curl -X POST "http://localhost:4041/api/v1/plants/import" \
  -H "X-API-Key: your-api-key" \
  -F "file=@plants.json"
```

### Ingest a Book
```bash
# Upload PDF/EPUB/TXT
curl -X POST http://localhost:4041/api/v1/books/upload \
  -H "Authorization: Bearer your-token" \
  -F "file=@my-garden-book.pdf"
# Returns { "jobId": "..." } — track progress via /books/jobs/:jobId

# From a web article
curl -X POST http://localhost:4041/api/v1/books/url \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/gardening-article"}'
```

---

## Connecting from Other Apps

Plain REST — no SDK required, works with any language.

```typescript
// TypeScript / JavaScript
const API_KEY = 'gt_abc123xy...';
const API = 'https://api.dnd-dad.com';

// Companion lookup (fast)
const { companionPlants, incompatiblePlants } = await fetch(
  `${API}/api/v1/search/companions?q=roma+tomato`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());

// Browse plants
const { items, total } = await fetch(
  `${API}/api/v1/plants?category=vegetable&take=20`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());

// RAG ask
const answer = await fetch(
  `${API}/api/v1/search/ask?q=how+to+grow+tomatoes&stream=false`,
  { headers: { 'X-API-Key': API_KEY } }
).then(r => r.json());
```

```python
import requests
API_KEY = 'gt_abc123xy...'
API = 'https://api.dnd-dad.com'

r = requests.get(f"{API}/api/v1/search/companions",
                 params={"q": "roma tomato"},
                 headers={"X-API-Key": API_KEY})
data = r.json()
print("Good neighbors:", data["companionPlants"])
print("Bad neighbors:",  data["incompatiblePlants"])
```

---

## Performance

| Endpoint | Typical Speed | Notes |
|----------|---------------|-------|
| `/search/companions` | **<50ms** | Pre-computed DB, no LLM |
| `/search/plants` | **<100ms** | DB index |
| `/search/enrich` | **<200ms** | DB or Brave Search |
| `/search` | 200–500ms | Vector search |
| `/search/ask` | 2–15s | LLM + optional web research |
| `/search/ask` (streaming) | ~1s to first token | SSE streaming |

---

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Bad request |
| `401` | Missing or invalid API key / token |
| `403` | Forbidden — insufficient permissions |
| `404` | Plant or resource not found |
| `422` | Validation error |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `502` | Downstream service error |
| `503` | Ollama or other dependency unavailable |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3002` | Port the API listens on |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | required | Secret for signing JWTs |
| `JWT_REFRESH_SECRET` | required | Secret for refresh tokens |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Model for generating embeddings |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | Model for chat synthesis |
| `OLLAMA_MAX_CONCURRENT` | `2` | Max concurrent Ollama requests |
| `UPLOADS_DIR` | `./uploads` | Where uploaded files are stored |
| `BRAVE_API_KEY` | — | Brave Search API key for web fallback |
| `SEARCH_CACHE_TTL_SECONDS` | `3600` | Search result cache TTL |
| `EMBEDDING_CACHE_TTL_SECONDS` | `604800` | Embedding cache TTL (7 days) |
