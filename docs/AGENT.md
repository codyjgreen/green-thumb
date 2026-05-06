# Green-Thumb API — Agent Guide

Green-Thumb is the plant-knowledge & RAG microservice that Fig talks to. It runs on **port 4041** and owns:
- Structured plant data (commonName, scientificName, growing conditions, companion planting)
- Semantic search over ingested book content (via Ollama embeddings)
- External data imports (Permapeople, web URLs)

Fig is the garden journal app that runs on **port 8000** (`/api/v1/...`). It syncs plant data to Green-Thumb and queries it for companion/pest advice.

---

## 🔑 Authentication

Green-Thumb uses two auth methods depending on the route:

**API Key** (for service-to-service calls like Fig → Green-Thumb):
```
X-API-Key: gt_MXZnEr96l3SgOEtlBCu50XccplVNNQaB
```

**JWT Bearer** (for user-facing routes, set as `Authorization: Bearer <token>`):
- Access secret: `JWT_ACCESS_SECRET` in env
- Refresh secret: `JWT_REFRESH_SECRET` in env

Route annotations in this doc say which auth each endpoint requires.

---

## 🌿 Key Endpoints (Green-Thumb :4041)

### Companion Plant Lookup — FAST (DB-only)
```
GET /search/companions?q=tomato
```
Instant DB lookup. Returns pre-stored companion + incompatible plant lists for any plant in the database. Falls back to `/search/recommend` if no DB data.

**Auth:** JWT (Bearer)

**Response:**
```json
{
  "source": "green-thumb-db",
  "plant": "Tomato",
  "scientificName": "Solanum lycopersicum",
  "companionPlants": ["Basil", "Carrot", "Marigold"],
  "incompatiblePlants": ["Fennel", "Brassica"],
  "growingInfo": {
    "sunlight": "Full sun",
    "waterNeeds": "Medium",
    "soilType": "Loamy",
    "hardinessZone": "9-11"
  }
}
```
Returns `404 { error: "Plant not found in DB" }` or `404 { error: "No companion data for this plant" }` when there's nothing to return — fall back to `/search/recommend` in either case.

---

### Gardening Recommendations — RAG-powered
```
GET /search/recommend?q=what can I plant with tomatoes&intent=companion
```
Ollama-powered semantic search across all ingested books. Slower but understands natural language.

**Auth:** JWT (Bearer)

**Query params:**
| Param | Values | Description |
|---|---|---|
| `q` | string | Natural language question (required) |
| `intent` | `companion`, `rotation`, `pest`, `soil`, `general` | Override auto-detected intent |
| `type` | `companion\|avoid\|succession\|cover\|pest_control\|soil_building\|general` | Filter by content type |
| `limit` | 1–50 | Max results (default 10) |
| `bookId` | uuid | Limit to a specific book |

Auto-detects intent from query keywords: "companion/with/avoid" → `companion`, "rotate/rotation/crop" → `rotation`, etc.

---

### Semantic Book Search
```
GET /search?q=composting techniques
```
Embeds the query and finds relevant chunks from all ingested books.

**Auth:** JWT (Bearer)

---

### Upsert a Plant (Structured Data)
```
POST /data/plants/upsert
```
Insert or update a single plant entry. Matches by `scientificName` + `variety` (exact match; falls back to `scientificName` alone if no variety given).

**Auth:** JWT (Bearer)

**Body:**
```json
{
  "commonName": "Cherokee Purple Tomato",
  "scientificName": "Solanum lycopersicum",
  "variety": "Cherokee Purple",
  "category": "vegetable",
  "sunlight": "Full sun",
  "waterNeeds": "Medium",
  "soilType": "Loamy",
  "zoneMin": 9,
  "zoneMax": 11,
  "companionPlants": ["Basil", "Carrot"],
  "incompatiblePlants": ["Fennel"],
  "commonPests": ["Aphids", "Hornworm"]
}
```
All fields optional except `commonName`. Only fields provided are updated.

**Returns:** `{ id, commonName, scientificName, currentVersion }`

---

### Import from Permapeople
```
POST /data/plants/import-from-permapeople
```
Search Permapeople and pull in growing conditions, zone ranges, water, soil, sunlight. Does **NOT** include companion planting data.

**Auth:** JWT (Bearer)

**Body:** `{ "query": "tomato", "limit": 5 }`

---

### Import from URL
```
POST /data/plants/from-url
```
Fetch any web article (Wikipedia, seed bank, gardening blog) and create a plant entry from it. Processing is async — returns 202 immediately.

**Body:** `{ "url": "https://en.wikipedia.org/wiki/Tomato", "commonName": "Tomato" }` (commonName optional)

**Auth:** None (rate-limited: 10/hour per IP)

---

### List / Get Plants
```
GET /plants?search=tomato&category=vegetable&limit=20
GET /plants/:plantId
POST /plants
PATCH /plants/:plantId
DELETE /plants/:plantId
```
Standard CRUD on the structured plant DB.

**Auth:** JWT (Bearer)

---

### Plant Version History
```
GET /plants/:plantId/versions
POST /plants/:plantId/versions/:version/restore
```
Every change is versioned. Restore re-applies an old version as a new update.

---

## 🌐 Key Endpoints (Fig Backend :8000/api/v1)

Fig proxies through Green-Thumb for its AI features and owns the garden journal + sync layer.

### Sync a Plant to Green-Thumb (Fig → Green-Thumb)
```
POST /api/v1/plants/:id/sync-to-greenthumb
```
Takes a Fig plant entry and upserts it to Green-Thumb. Companion/pest advice from RAG is stored in Fig's `metadataJson`, not here.

**Auth:** JWT (Bearer) + garden membership check

---

### Get RAG Recommendations (Fig cache)
```
GET /api/v1/plants/:id/rag-recommendations
```
Returns cached companion planting + pest advice from the last sync (instant). Falls back to live RAG query if no cache.

**Auth:** JWT (Bearer) + garden membership check

**Response:**
```json
{
  "plantId": "...",
  "plantName": "Cherokee Purple Tomato",
  "companionAdvice": "Plant with basil for pest deterrence...",
  "pestAdvice": "Watch for aphids and hornworms...",
  "fromCache": true
}
```

Rate-limited: 30/min.

---

### Sync Changes (Offline-first)
```
POST /api/v1/sync
```
Core sync endpoint. Client sends a batch of changes per garden. Server resolves conflicts via version numbers and writes a `SyncChange` record.

**Auth:** JWT (Bearer)

**Body:**
```json
{
  "gardenId": "uuid",
  "deviceId": "uuid",
  "changes": [
    {
      "clientChangeId": "uuid",
      "entityType": "plant | journal_entry | media",
      "entityId": "uuid",
      "operation": "create | update | delete",
      "baseVersion": 0,
      "data": { ... }
    }
  ]
}
```

---

### External Plant Lookup (free, no auth)
```
GET /api/v1/plants/lookup?query=tomato
```
Searches OpenFarm, Wikipedia, and USDA. Free, no auth. Results cached in DB.

---

## 🔄 Typical Agent Flow (Fig Sync)

When a user syncs a plant in Fig:

1. **Fig** calls `POST /api/v1/plants/:id/sync-to-greenthumb`
2. **greenThumbService** calls `POST /green-thumb:4041/data/plants/upsert` (X-API-Key auth)
3. **Fig** calls `GET /green-thumb:4041/search/companions?q=<plant>` — instant DB lookup
4. Companion + pest advice stored in Fig's `metadataJson` on the plant record
5. On next sync, **Fig** checks `GET /api/v1/plants/:id/rag-recommendations` — cached → return instantly; no cache → falls back to `GET /search/recommend`

---

## 📦 Env Variables (Green-Thumb)

```
GREEN_THUMB_API_URL=http://localhost:4041
GREEN_THUMB_API_KEY=gt_MXZnEr96l3SgOEtlBCu50XccplVNNQaB  # service-to-service (Fig → GT)
JWT_ACCESS_SECRET=dev-access-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
OLLAMA_BASE_URL=http://192.168.0.27:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=gemma4:latest
PERMAPEOPLE_KEY_ID=cGWpF4F5rThx
PERMAPEOPLE_KEY_SECRET=9d314d52-573e-4fb2-9953-1ecd1e9bdac7
```

---

## ⚠️ Gotchas

- **`companionPlants: []` (empty array) vs no data** — 937 plant records had empty arrays cleared by `fix-empty-companion-arrays.ts`. An empty array is falsy; `null`/missing means "not enriched yet" and can be retried.
- **Variety matching** — `POST /data/plants/upsert` matches on `scientificName + variety`. Older Fig records may have `variety = null` for named varieties. The upsert fallback retries with `variety: null`.
- **RAG cache TTL** — RAG query results are cached for 2 hours (in-memory in Green-Thumb). Companion plant DB lookups are not cached.
- **Permapeople has no companion data** — only growing conditions (zones, sunlight, water, soil). Companion planting must come from the Wikipedia/extension seed scripts or RAG.
- **URL import is async** — returns `202` with a `jobId`. No job status endpoint — just wait before retrying.
- **JWT vs API key in Green-Thumb** — write ops + search/recommend use JWT. The `from-url` import has no auth but is rate-limited.
- **Fig catalog routes** at `GET /api/v1/catalog`, `POST /api/v1/catalog/lookup` search Perenual + Green-Thumb combined.
