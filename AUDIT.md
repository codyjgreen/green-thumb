# Green-Thumb API Audit Findings

**Date:** 2026-05-05  
**Auditor:** Samwise (Subagent)  
**Scope:** `src/routes/`, `src/lib/`, `src/services/`

---

## Test Status Summary

| File | Tests | Passing | Failing |
|------|-------|---------|---------|
| config.test.ts | 9 | 9 | 0 |
| auth.test.ts | 12 | 12 | 0 |
| extractor.test.ts | 23 | 23 | 0 |
| search.test.ts | 17 | 16 | 1 |
| ollama.test.ts | 14 | 12 | 2 |
| **Total** | **75** | **72** | **3** |

### Failing Tests (Known Issues)

1. **search.test.ts**: `/search/plants > returns error for missing query` returns 500 instead of 400
   - Root cause: Module mock timing issue with vitest where `ollama.js` mock not properly applied between test files
   - The `/search/plants` route calls `queryOllamaEmbedding` which should use the mocked version but may be using the real implementation

2. **ollama.test.ts**: First 2 `queryOllamaChat` tests timeout (5000ms)
   - Root cause: Test pollution between `queryOllamaEmbedding` and `queryOllamaChat` describe blocks
   - When embedding tests run before chat tests, the module state causes chat tests to call the real `ollamaEnqueue` which attempts HTTP calls
   - Isolated chat tests pass correctly

---

## Top 5 Code Quality / DRY Improvements

### 1. Zod Schemas Repeated Across Routes
**Severity:** Medium | **Files:** `src/routes/search.ts`, `src/routes/plants.ts`

The search query schema is repeated 6+ times with slight variations:
```typescript
// Repeated pattern:
z.object({
  q: z.string().min(1),
  limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50).default(10)),
})
```

**Fix:** Extract to `src/lib/schemas.ts`:
```typescript
export const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.preprocess((val) => Number(val), z.number().int().min(1).max(50)).default(10),
});
```

### 2. `loadConfig()` Called in Multiple Service Functions
**Severity:** Medium | **Files:** `src/services/search.ts`, `src/services/ollama.ts`

`loadConfig()` reads from `process.env` and is called inside service functions. When tests mock `config.js`, the mock may not apply correctly due to module evaluation order.

**Fix:** Consider injecting config via Fastify's `app.config` (already done for routes) or create a testable config accessor that can be mocked.

### 3. `fetchArticleText` Duplicated in enrich.ts and data.ts
**Severity:** Low | **Files:** `src/services/enrich.ts`, `src/routes/data.ts`

The `fetchArticleText` function appears to have similar implementations in two places.

**Fix:** Extract to `src/services/web.js` or `src/lib/fetch.ts` as a shared utility.

### 4. Error Handling Inconsistency
**Severity:** Medium | **Files:** `src/routes/search.ts`

The `/search/plants` route has no try/catch, relying on Fastify's error handler. But when Zod validation fails inside an async handler, the error may not be properly caught.

**Fix:** Wrap route handlers with proper error handling or ensure Fastify's error handler catches all error types.

### 5. Redis Failure Silently Ignored in Multiple Places
**Severity:** Low | **Files:** `src/services/search.ts`, `src/services/ollama.ts`

Redis cache failures are caught but only silently logged:
```typescript
} catch {
  // Cache write failure is non-fatal
}
```

**Fix:** Consider logging at warn level instead of silently ignoring, to aid debugging.

---

## Top 5 Security Fixes

### 1. Auth Bypass on Book Routes (Already Known)
**Severity:** High | **File:** `src/routes/books.ts`

The book routes have an auth bypass on DELETE `/books/:bookId`. Ensure this is intentional for the application's use case.

### 2. No Rate Limiting on Ollama Endpoints
**Severity:** Medium | **File:** `src/routes/search.ts`

The `/search/ask` endpoint can make multiple Ollama calls per request. Consider adding rate limiting.

### 3. Missing Input Validation on `request.body`
**Severity:** Medium | **File:** `src/routes/plants.ts`

The `upsertPlantSchema` has many optional fields. Ensure the schema validates all fields properly and doesn't allow unexpected keys.

### 4. File Upload Path Traversal Risk
**Severity:** High | **File:** `src/routes/books.ts`

File uploads should validate filenames to prevent path traversal attacks.

### 5. SSE Stream Not Auth-Checked
**Severity:** Medium | **File:** `src/routes/search.ts`

The `/search/ask` SSE stream endpoint should verify authentication before starting the stream.

---

## Top 10 Functions Needing Tests

1. `semanticSearch` in `src/services/search.ts` - Core search logic with Redis caching
2. `queryOllamaEmbedding` in `src/services/ollama.ts` - Embedding generation with caching
3. `queryOllamaChat` in `src/services/ollama.ts` - Chat completions
4. `upsertPlant` in `src/routes/plants.ts` - Plant CRUD operations
5. `createBook` / `uploadBook` in `src/routes/books.ts` - Book ingestion
6. `processUrlIngestion` in `src/routes/books.ts` - URL-based data ingestion
7. `enrichPlantData` in `src/services/enrich.ts` - Plant data enrichment
8. `companionLookup` in `src/services/search.ts` - Companion plant logic
9. `recordVersion` in `src/services/plant-versions.ts` - Version recording
10. `braveSearch` in `src/services/web.ts` - Web search functionality

---

## DRY Improvements Applied

### 1. Config Mock in search.test.ts
Added `vi.mock('../../src/config.js', ...)` to properly mock config loading, fixing 11 of 12 failing tests.

### 2. Ollama Mock Strategy
The `ollama.js` service is now mocked at the top of search.test.ts to bypass real Ollama calls.

---

## Recommendations

1. **Fix Test Infrastructure:** The vitest module mocking has complexities with ES modules. Consider:
   - Using `vi.resetModules()` strategically
   - Running tests in isolated workers
   - Using `vi.mockActual()` where appropriate

2. **Add Integration Tests:** Unit tests with mocks are fragile. Consider adding integration tests that test the full flow with test databases.

3. **Centralize Schemas:** Extract repeated Zod schemas to a central location.

4. **Document Auth Expectations:** Clearly document which routes should require auth and which should be public.

5. **Add Error Boundaries:** Wrap async route handlers with proper error handling to ensure 400 errors are returned for validation failures.
