# Green-Thumb 🌱

**Gardening knowledge RAG API** — ingest PDF/EPUB/TXT books, extract and embed plant information, then query your gardening knowledge base from any app via a clean REST API.

> Think of it as a personal gardening wiki you train from your own book collection.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env

# 3. Start PostgreSQL + pgvector (or reuse existing)
docker compose -f infra/docker/docker-compose.yml up -d postgres

# 4. Create tables
npm run db:push

# 5. Start the dev server
npm run dev
```

API available at `http://localhost:3002` with docs at `http://localhost:3002/docs`.

## Architecture

```
Book (PDF/EPUB/TXT)
  └─► Extract text by chapter/section
        └─► Classify content type (plant, pest, composting, tip, task, general)
              └─► Split into chunks (~400 tokens, paragraph-aware)
                    └─► Embed each chunk with local Ollama
                          └─► Store in PostgreSQL + pgvector

Query
  └─► Embed query with Ollama
        └─► pgvector cosine similarity search
              └─► Return ranked chunks + source book
                    └─► (Optional) Synthesize answer with Ollama chat
```

## API Reference

All endpoints prefixed with `/api/v1`. Authentication via JWT Bearer token.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/health` | No | Health check |
| `POST` | `/api/v1/auth/signup` | No | Create account |
| `POST` | `/api/v1/auth/login` | No | Get JWT access token |
| `GET` | `/api/v1/books` | Yes | List all ingested books |
| `GET` | `/api/v1/books/:bookId` | Yes | Get book details |
| `POST` | `/api/v1/books/upload` | Yes | Upload and ingest a book |
| `DELETE` | `/api/v1/books/:bookId` | Yes | Delete a book and its chunks |
| `GET` | `/api/v1/search?q=...` | Yes | Semantic search across all knowledge |
| `GET` | `/api/v1/search/plants?q=...` | Yes | Semantic search filtered to plant info |
| `GET` | `/api/v1/search/pests?q=...` | Yes | Semantic search for pest/disease info |
| `GET` | `/api/v1/search/tips?q=...` | Yes | Semantic search for tips and tasks |
| `GET` | `/api/v1/plants` | Yes | List structured plant entries |
| `GET` | `/api/v1/plants/:plantId` | Yes | Get a specific plant entry |
| `POST` | `/api/v1/plants` | Yes | Create/update a plant entry |
| `GET` | `/api/v1/tasks` | Yes | List tasks and tips from books |
| `GET` | `/api/v1/tasks/:taskId` | Yes | Get a specific task |

## Authentication

```bash
# Sign up
curl -X POST http://localhost:3002/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# Login
curl -X POST http://localhost:3002/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# Use the token
curl http://localhost:3002/api/v1/books \
  -H "Authorization: Bearer <accessToken>"
```

## Ingesting a Book

```bash
curl -X POST http://localhost:3002/api/v1/books/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@my-gardening-book.pdf"
```

The book is automatically:
1. Extracted page-by-page (PDF) or chapter-by-chapter (EPUB)
2. Split into semantically coherent chunks
3. Classified by content type (plant, pest, composting, tip, task)
4. Embedded using Ollama's `nomic-embed-text` model
5. Stored in PostgreSQL + pgvector

## Searching

```bash
# General search
curl "http://localhost:3002/api/v1/search?q=tomato+blight" \
  -H "Authorization: Bearer <token>"

# Plant-specific
curl "http://localhost:3002/api/v1/search/plants?q=companion+planting+tomatoes" \
  -H "Authorization: Bearer <token>"

# Filter by content type
curl "http://localhost:3002/api/v1/search?q=composting+guide&type=composting" \
  -H "Authorization: Bearer <token>"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `3002` | Port the API listens on |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | required | Secret for signing JWTs |
| `JWT_REFRESH_SECRET` | required | Secret for refresh tokens |
| `UPLOADS_DIR` | `./uploads` | Where uploaded files are stored |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_EMBEDDING_MODEL` | `llama3.2:3b` | Model for generating embeddings |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | Model for chat synthesis |

## Database Schema

```
books          — uploaded book metadata
book_chunks    — extracted text sections with content type tags
chunk_embeddings — vector embeddings (pgvector Float[])
plant_entries  — structured plant info (common name, family, etc.)
users          — auth accounts
```

pgvector is used for semantic search via cosine similarity (`<=>` operator).

## Content Types

Each chunk is tagged with one of:

| Type | Description |
|------|-------------|
| `plant` | Planting, spacing, variety, harvest info |
| `pest` | Insects, bugs, aphids, beetles |
| `disease` | Blight, mold, rot, fungus |
| `composting` | Composting, organic matter, soil health |
| `tip` | General tips, notes, warnings |
| `task` | Actionable tasks (prune, water, spray) |
| `general` | Unclassified content |

## Connecting from Other Apps

Any HTTP client can consume this API. Example from the Greenery app:

```typescript
const res = await fetch('http://localhost:3002/api/v1/search/plants?q=carrot+growing', {
  headers: { Authorization: `Bearer ${token}` },
});
const { items } = await res.json();
```

The API is intentionally plain REST — no SDK required, works with any language or platform.

## Docker

```bash
# Full stack (API + PostgreSQL)
docker compose -f infra/docker/docker-compose.yml up -d

# Just the API (use existing PostgreSQL)
docker build -f infra/docker/Dockerfile -t green-thumb-api .
```

## Development

```bash
npm run typecheck   # Type-check without emitting
npm test            # Run tests
npm run ingest      # Run ingestion CLI script
```

## Tech Stack

- **Fastify** — Fast, low-overhead web framework
- **Prisma** — Type-safe database ORM
- **pgvector** — Vector similarity search in PostgreSQL
- **Ollama** — Local LLM inference (no external API calls)
- **pdfplumber** — PDF text extraction
- **epub2** / direct parse — EPUB extraction
